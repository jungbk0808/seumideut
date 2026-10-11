import { useEffect, useSyncExternalStore } from "react";
import { getAuthController } from "./cloud/auth";

export function AccountPanel() {
  const controller = getAuthController();
  const { phase, user, error } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.initialize(); }, [controller]);
  const busy = phase !== "ready" && phase !== "unconfigured";
  const buttonText = phase === "opening" ? "브라우저 여는 중..."
    : phase === "waiting" ? "로그인 기다리는 중..."
    : phase === "exchanging" ? "로그인 확인 중..."
    : phase === "signing-out" ? "로그아웃 중..."
    : phase === "loading" ? "로그인 확인 중..."
    : user ? "로그아웃" : "Google로 로그인";

  return (
    <div className="settings-section" aria-label="계정">
      <span className="settings-section-label">계정</span>
      <div className="settings-card">
        <div className="settings-row">
          <span className="account-identity" aria-live="polite">
            {user ? user.email ?? "Google 계정으로 로그인됨" : "로그인하지 않음"}
          </span>
          <button className="text-button" type="button" disabled={busy || phase === "unconfigured"}
            onClick={() => { void (user ? controller.signOut() : controller.signIn()); }}>
            {buttonText}
          </button>
        </div>
        {phase === "waiting" && (
          <div className="settings-row">
            <p className="settings-help" role="status">브라우저에서 Google 로그인을 완료해 주세요.</p>
            <button className="text-button" type="button" onClick={() => { void controller.cancel(); }}>취소</button>
          </div>
        )}
        <p className="settings-help">
          {phase === "unconfigured" ? "로그인 연결 정보가 아직 설정되지 않았어요. 로컬 메모는 계속 사용할 수 있어요."
            : "메모는 계속 이 PC에 저장됩니다. 계정의 메모 동기화는 준비 중이에요."}
        </p>
        {error && <p className="settings-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
