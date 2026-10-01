import {
  AUTH_PROVIDERS,
  type Account,
  type AuthProviderId,
  getProviderLabel,
} from "./account";

export type SyncState = "idle" | "syncing" | "failed";

type SettingsPanelProps = {
  account: Account | null;
  isSigningIn: boolean;
  authError: string | null;
  onSignIn: (providerId: AuthProviderId) => void;
  onSignOut: () => void;
  isSyncAvailable: boolean;
  syncState: SyncState;
  lastSyncedText: string | null;
  storageDir: string | null;
  isFolderChangeAvailable: boolean;
  isChangingFolder: boolean;
  folderError: string | null;
  onSync: () => void;
  onChangeFolder: () => void;
};

function getSyncDescription(
  isSyncAvailable: boolean,
  syncState: SyncState,
  lastSyncedText: string | null,
) {
  if (!isSyncAvailable) return "로그인 후 사용할 수 있어요";
  if (syncState === "syncing") return "동기화 중...";
  if (syncState === "failed") return "동기화하지 못했어요. 다시 시도해 주세요.";

  return lastSyncedText
    ? `마지막 동기화 · ${lastSyncedText}`
    : "아직 동기화하지 않았어요";
}

export function SettingsPanel({
  account,
  isSigningIn,
  authError,
  onSignIn,
  onSignOut,
  isSyncAvailable,
  syncState,
  lastSyncedText,
  storageDir,
  isFolderChangeAvailable,
  isChangingFolder,
  folderError,
  onSync,
  onChangeFolder,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="설정">
      <h2 className="settings-title">설정</h2>

      <div className="settings-section">
        <span className="settings-section-label">계정</span>
        <div className="settings-card">
          {account ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <strong>{account.email}</strong>
                <span>{getProviderLabel(account.provider)} 계정으로 로그인</span>
              </div>
              <button className="text-button" type="button" onClick={onSignOut}>
                로그아웃
              </button>
            </div>
          ) : (
            <>
              <div className="settings-row-text">
                <strong>로그인되어 있지 않아요</strong>
                <span>소셜 계정으로 로그인해 동기화를 사용하세요.</span>
              </div>
              <div className="social-login-buttons">
                {AUTH_PROVIDERS.map((provider) => (
                  <button
                    className="social-login-button"
                    type="button"
                    key={provider.id}
                    disabled={isSigningIn}
                    onClick={() => onSignIn(provider.id)}
                  >
                    {isSigningIn
                      ? "로그인 중..."
                      : `${provider.label}로 계속하기`}
                  </button>
                ))}
              </div>
            </>
          )}
          {authError && (
            <p className="settings-error" role="alert">
              {authError}
            </p>
          )}
        </div>
      </div>

      <div className="settings-section">
        <span className="settings-section-label">동기화</span>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <strong>수동 동기화</strong>
              <span role={syncState === "failed" ? "alert" : undefined}>
                {getSyncDescription(isSyncAvailable, syncState, lastSyncedText)}
              </span>
            </div>
            <button
              className="text-button"
              type="button"
              disabled={!isSyncAvailable || syncState === "syncing"}
              onClick={onSync}
            >
              {syncState === "syncing" ? "동기화 중..." : "지금 동기화"}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <span className="settings-section-label">파일 저장 폴더</span>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-path-field" title={storageDir ?? undefined}>
              {storageDir ?? "브라우저 미리보기에서는 폴더를 지정할 수 없어요"}
            </div>
            <button
              className="text-button"
              type="button"
              disabled={!isFolderChangeAvailable || isChangingFolder}
              onClick={onChangeFolder}
            >
              {isChangingFolder ? "변경 중..." : "폴더 변경"}
            </button>
          </div>
          <p className="settings-help">
            메모가 이 폴더에 메모마다 .md 파일로 저장됩니다. 폴더를 바꾸면 기존
            메모도 새 폴더로 옮겨집니다.
          </p>
          {folderError && (
            <p className="settings-error" role="alert">
              {folderError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
