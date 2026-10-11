import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSupabaseClient, getAuthStorageKey, nativeAuthStorage } from "./client";
import { readSupabaseConfig } from "./config";
import { AuthController, type AuthPlatform, type OAuthResult } from "./authController";
import { consumeBrowserOAuth } from "./browserOAuth";

const BROWSER_PENDING_KEY = "seumideut.oauth.pending";
let controller: AuthController | undefined;

function createPlatform(): AuthPlatform {
  const native = "__TAURI_INTERNALS__" in window;
  return {
    native,
    createAttemptId: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join(""),
    start: async (attemptId) => {
      if (native) return invoke<string>("start_oauth_callback", { attemptId });
      sessionStorage.setItem(BROWSER_PENDING_KEY, JSON.stringify({ attemptId, startedAt: Date.now() }));
      const redirect = new URL(window.location.pathname, window.location.origin);
      redirect.search = new URLSearchParams({ view: "full", panel: "settings", authAttempt: attemptId }).toString();
      return redirect.href;
    },
    cancel: async () => {
      if (native) await invoke("cancel_oauth_callback");
      else sessionStorage.removeItem(BROWSER_PENDING_KEY);
    },
    clearVerifier: async () => {
      const config = readSupabaseConfig(import.meta.env);
      if (!config) return;
      const key = `${getAuthStorageKey(config.url)}-code-verifier`;
      if (native) await nativeAuthStorage.removeItem(key);
      else localStorage.removeItem(key);
    },
    open: async (url) => {
      if (native) await invoke("open_oauth_url", { url });
      else window.location.assign(url);
    },
    listen: async (callback) => {
      if (!native) return () => {};
      return getCurrentWindow().listen<OAuthResult>("native-oauth-result", ({ payload }) => callback(payload));
    },
    consumeBrowserResult: () => {
      if (native) return null;
      const { result, cleanUrl } = consumeBrowserOAuth(window.location.href, sessionStorage.getItem(BROWSER_PENDING_KEY), Date.now());
      if (cleanUrl !== window.location.href) history.replaceState(history.state, "", cleanUrl);
      sessionStorage.removeItem(BROWSER_PENDING_KEY);
      return result;
    },
  };
}

export function getAuthController() {
  if (controller) return controller;
  const platform = createPlatform();
  try {
    controller = new AuthController(getSupabaseClient(), platform);
  } catch {
    controller = new AuthController(null, platform, "로그인 연결 정보를 확인하고 앱을 다시 열어 주세요.");
  }
  return controller;
}
