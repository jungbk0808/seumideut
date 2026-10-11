//! Windows user-bound DPAPI storage, separate from all memo folders.
use std::sync::Mutex;
use std::{collections::BTreeMap, fs, path::Path};
use tauri::{Manager, State, WebviewWindow};

#[derive(Default)]
pub struct AuthStorageLock(pub Mutex<()>);

pub fn require_auth_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "full" {
        Ok(())
    } else {
        Err("로그인은 전체 메모 창의 설정에서 진행하세요.".into())
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.starts_with("seumideut.auth.")
        && key.len() < 256
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        Ok(())
    } else {
        Err("올바르지 않은 로그인 저장 키입니다.".into())
    }
}

#[cfg(windows)]
fn crypt(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data
            .len()
            .try_into()
            .map_err(|_| "로그인 정보가 너무 큽니다.")?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI output is allocated by Windows; copy it before releasing with LocalFree.
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err("Windows 로그인 정보 암호화 저장소에 접근할 수 없습니다.".into());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn crypt(_data: &[u8], _encrypt: bool) -> Result<Vec<u8>, String> {
    Err("데스크톱 로그인 저장소는 현재 Windows에서 지원합니다.".into())
}

fn read_store(path: &Path) -> Result<BTreeMap<String, String>, String> {
    let encrypted = match fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(_) => return Err("로그인 정보를 불러올 수 없습니다.".into()),
    };
    serde_json::from_slice(&crypt(&encrypted, false)?)
        .map_err(|_| "저장된 로그인 정보를 읽을 수 없습니다.".into())
}

fn write_store(path: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    let raw = serde_json::to_vec(values).map_err(|_| "로그인 정보를 저장할 수 없습니다.")?;
    let encrypted = crypt(&raw, true)?;
    fs::create_dir_all(
        path.parent()
            .ok_or("로그인 저장 위치를 찾을 수 없습니다.")?,
    )
    .map_err(|_| "로그인 저장 폴더를 만들 수 없습니다.")?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, encrypted).map_err(|_| "로그인 정보를 저장할 수 없습니다.")?;
    // std::fs::rename replaces an existing file on Windows without a delete gap.
    fs::rename(&temporary, path).map_err(|_| "로그인 정보 저장을 완료할 수 없습니다.".into())
}

#[tauri::command]
pub fn auth_storage_get(
    window: WebviewWindow,
    key: String,
    lock: State<'_, AuthStorageLock>,
) -> Result<Option<String>, String> {
    require_auth_window(&window)?;
    validate_key(&key)?;
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "로그인 저장소가 사용 중입니다.")?;
    let path = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| "로그인 저장 위치를 찾을 수 없습니다.")?
        .join("auth-session.dpapi");
    Ok(read_store(&path)?.remove(&key))
}

#[tauri::command]
pub fn auth_storage_set(
    window: WebviewWindow,
    key: String,
    value: Option<String>,
    lock: State<'_, AuthStorageLock>,
) -> Result<(), String> {
    require_auth_window(&window)?;
    validate_key(&key)?;
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "로그인 저장소가 사용 중입니다.")?;
    let path = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| "로그인 저장 위치를 찾을 수 없습니다.")?
        .join("auth-session.dpapi");
    let mut values = read_store(&path)?;
    match value {
        Some(value) => {
            values.insert(key, value);
        }
        None => {
            values.remove(&key);
        }
    }
    write_store(&path, &values)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_other_storage_keys_and_paths() {
        assert!(validate_key("seumideut.auth.project.supabase.co-code-verifier").is_ok());
        for key in ["notes", "../settings.json", "seumideut.auth./secret", ""] {
            assert!(validate_key(key).is_err());
        }
    }
    #[cfg(windows)]
    #[test]
    fn encrypts_and_restores_large_sessions_and_rejects_corruption() {
        let data = "private refresh token ".repeat(1000).into_bytes();
        let encrypted = crypt(&data, true).unwrap();
        assert_ne!(encrypted, data);
        assert_eq!(crypt(&encrypted, false).unwrap(), data);
        assert!(crypt(b"invalid encrypted session", false).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn persists_replacements_and_verifier_removal_without_losing_session() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = std::env::temp_dir().join(format!(
            "seumideut-auth-test-{}-{unique}",
            std::process::id()
        ));
        let path = folder.join("auth-session.dpapi");
        assert!(read_store(&path).unwrap().is_empty());
        let session_key = "seumideut.auth.project.supabase.co".to_string();
        let verifier_key = format!("{session_key}-code-verifier");
        let mut values = BTreeMap::from([(session_key.clone(), "session-one".into())]);
        write_store(&path, &values).unwrap();
        assert_eq!(read_store(&path).unwrap(), values);
        values.insert(session_key.clone(), "session-two".into());
        values.insert(verifier_key.clone(), "pkce-verifier".into());
        write_store(&path, &values).unwrap();
        let mut restored = read_store(&path).unwrap();
        restored.remove(&verifier_key);
        write_store(&path, &restored).unwrap();
        assert_eq!(
            read_store(&path).unwrap().get(&session_key).unwrap(),
            "session-two"
        );
        restored.clear();
        write_store(&path, &restored).unwrap();
        assert!(read_store(&path).unwrap().is_empty());
        assert!(!path.with_extension("tmp").exists());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&folder).unwrap();
    }
}
