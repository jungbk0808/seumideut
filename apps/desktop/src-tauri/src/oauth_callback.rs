//! Short-lived loopback callback for browser OAuth. No tokens travel in URLs.
use crate::auth_storage::require_auth_window;
use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State, Url, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const ADDRESS: &str = "127.0.0.1:1421";
const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallbackResult {
    attempt_id: String,
    code: Option<String>,
    error: Option<String>,
}
struct ActiveCallback {
    attempt_id: String,
    cancel: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}
#[derive(Default)]
pub struct OAuthCallbackState(Mutex<Option<ActiveCallback>>);

fn valid_attempt(attempt: &str) -> bool {
    attempt.len() == 64 && attempt.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_request(request: &str, attempt: &str) -> Option<CallbackResult> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let target = first.next()?;
    if !target.starts_with('/') || target.starts_with("//") || first.next()? != "HTTP/1.1" {
        return None;
    }
    let host_valid = lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("host") && value.trim() == ADDRESS
        })
    });
    if !host_valid {
        return None;
    }
    let url = Url::parse(&format!("http://{ADDRESS}{target}")).ok()?;
    if url.path() != format!("/auth/callback/{attempt}") {
        return None;
    }
    let codes: Vec<_> = url
        .query_pairs()
        .filter(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .collect();
    let failed = url
        .query_pairs()
        .any(|(key, _)| key == "error" || key == "error_code");
    if failed {
        return Some(CallbackResult {
            attempt_id: attempt.into(),
            code: None,
            error: Some("denied".into()),
        });
    }
    // OAuth errors may arrive in a URL fragment, which HTTP cannot transmit.
    // A matching nonce with no code is therefore a failed login, never a success.
    if codes.is_empty() {
        return Some(CallbackResult {
            attempt_id: attempt.into(),
            code: None,
            error: Some("denied".into()),
        });
    }
    if codes.len() != 1 || codes[0].is_empty() || codes[0].len() > 2048 {
        return None;
    }
    Some(CallbackResult {
        attempt_id: attempt.into(),
        code: Some(codes[0].clone()),
        error: None,
    })
}

fn read_request(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok()?;
    let started = Instant::now();
    let mut request = Vec::new();
    while request.len() < 8192 && started.elapsed() < Duration::from_secs(2) {
        let mut buffer = [0u8; 1024];
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        request.extend_from_slice(&buffer[..count]);
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            return String::from_utf8(request).ok();
        }
    }
    None
}

fn respond(stream: &mut TcpStream, accepted: bool) {
    let (status, body) = if accepted {
        ("200 OK", "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>스미듯 로그인</title><h1>앱에서 로그인 결과를 확인하세요.</h1><p>인증 응답을 전달했습니다. 이 탭은 닫아도 됩니다.</p></html>")
    } else {
        ("404 Not Found", "Not found")
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
}

#[tauri::command]
pub fn start_oauth_callback(
    window: WebviewWindow,
    attempt_id: String,
    state: State<'_, OAuthCallbackState>,
) -> Result<String, String> {
    require_auth_window(&window)?;
    if !valid_attempt(&attempt_id) {
        return Err("로그인 요청을 만들 수 없습니다.".into());
    }
    let mut active = state.0.lock().map_err(|_| "로그인 요청이 사용 중입니다.")?;
    if active
        .as_ref()
        .is_some_and(|entry| !entry.thread.is_finished())
    {
        return Err("이미 로그인을 진행 중입니다. 먼저 취소하세요.".into());
    }
    let listener = TcpListener::bind(ADDRESS).map_err(|_| {
        "로그인 복귀용 1421 포트를 열 수 없습니다. 다른 앱의 사용 여부를 확인하세요."
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "로그인 복귀를 준비할 수 없습니다.")?;
    let redirect_url = format!("http://{ADDRESS}/auth/callback/{attempt_id}");
    let active_attempt = attempt_id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let thread_cancel = cancel.clone();
    let thread = thread::spawn(move || {
        let started = Instant::now();
        loop {
            if thread_cancel.load(Ordering::SeqCst)
                || window
                    .app_handle()
                    .get_webview_window(window.label())
                    .is_none()
            {
                return;
            }
            if started.elapsed() >= TIMEOUT {
                let _ = window.emit(
                    "native-oauth-result",
                    CallbackResult {
                        attempt_id,
                        code: None,
                        error: Some("timeout".into()),
                    },
                );
                return;
            }
            match listener.accept() {
                Ok((mut stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let result =
                        read_request(&mut stream).and_then(|raw| parse_request(&raw, &attempt_id));
                    respond(&mut stream, result.is_some());
                    if let Some(result) = result {
                        if !thread_cancel.load(Ordering::SeqCst) {
                            let _ = window.emit("native-oauth-result", result);
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => {
                    let _ = window.emit(
                        "native-oauth-result",
                        CallbackResult {
                            attempt_id,
                            code: None,
                            error: Some("callback".into()),
                        },
                    );
                    return;
                }
            }
        }
    });
    *active = Some(ActiveCallback {
        attempt_id: active_attempt,
        cancel,
        thread,
    });
    Ok(redirect_url)
}

#[tauri::command]
pub async fn cancel_oauth_callback(
    window: WebviewWindow,
    state: State<'_, OAuthCallbackState>,
) -> Result<(), String> {
    require_auth_window(&window)?;
    let entry = state
        .0
        .lock()
        .map_err(|_| "로그인 요청이 사용 중입니다.")?
        .take();
    if let Some(entry) = entry {
        entry.cancel.store(true, Ordering::SeqCst);
        let _ = tauri::async_runtime::spawn_blocking(move || entry.thread.join()).await;
    }
    Ok(())
}

#[tauri::command]
pub fn open_oauth_url(
    window: WebviewWindow,
    url: String,
    state: State<'_, OAuthCallbackState>,
) -> Result<(), String> {
    require_auth_window(&window)?;
    let parsed = Url::parse(&url).map_err(|_| "올바르지 않은 로그인 주소입니다.")?;
    let local_http = parsed.scheme() == "http" && parsed.host_str() == Some("127.0.0.1");
    if (parsed.scheme() != "https" && !local_http)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/auth/v1/authorize"
    {
        return Err("올바르지 않은 로그인 주소입니다.".into());
    }
    let parameters: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    let active = state.0.lock().map_err(|_| "로그인 요청이 사용 중입니다.")?;
    let expected_redirect = active
        .as_ref()
        .map(|entry| format!("http://{ADDRESS}/auth/callback/{}", entry.attempt_id));
    if expected_redirect.is_none()
        || parameters.get("redirect_to") != expected_redirect.as_ref()
        || parameters.get("provider").map(String::as_str) != Some("google")
        || parameters.get("code_challenge_method").map(String::as_str) != Some("s256")
    {
        return Err("로그인 요청과 복귀 주소를 확인할 수 없습니다.".into());
    }
    window
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "기본 브라우저를 열 수 없습니다.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const ATTEMPT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    fn request(path: &str) -> String {
        format!("GET {path} HTTP/1.1\r\nHost: {ADDRESS}\r\n\r\n")
    }
    #[test]
    fn accepts_matching_pkce_response_and_provider_cancellation() {
        let result = parse_request(
            &request(&format!("/auth/callback/{ATTEMPT}?code=auth-code")),
            ATTEMPT,
        )
        .unwrap();
        assert_eq!(result.code.as_deref(), Some("auth-code"));
        assert!(parse_request(
            &request(&format!("/auth/callback/{ATTEMPT}?error=access_denied")),
            ATTEMPT
        )
        .unwrap()
        .error
        .is_some());
    }
    #[test]
    fn rejects_wrong_nonce_host_method_and_duplicate_codes() {
        for path in [
            "/favicon.ico".into(),
            "/auth/callback/wrong?code=code".into(),
            format!("/auth/callback/{ATTEMPT}?code=a&code=b"),
            format!("/auth/callback/{ATTEMPT}?code="),
        ] {
            assert!(parse_request(&request(&path), ATTEMPT).is_none());
        }
        let valid = request(&format!("/auth/callback/{ATTEMPT}?code=a"));
        assert!(parse_request(&valid.replace(ADDRESS, "attacker.example"), ATTEMPT).is_none());
        assert!(parse_request(&valid.replace("GET", "POST"), ATTEMPT).is_none());
        assert!(!valid_attempt("../../file"));
    }
}
