export type SyncState = "idle" | "syncing" | "failed";

type SettingsPanelProps = {
  syncState: SyncState;
  lastSyncedText: string | null;
  storageDir: string | null;
  isFolderChangeAvailable: boolean;
  isChangingFolder: boolean;
  folderError: string | null;
  onSync: () => void;
  onChangeFolder: () => void;
};

function getSyncDescription(syncState: SyncState, lastSyncedText: string | null) {
  if (syncState === "syncing") return "동기화 중...";
  if (syncState === "failed") return "동기화하지 못했어요. 다시 시도해 주세요.";

  return lastSyncedText
    ? `마지막 동기화 · ${lastSyncedText}`
    : "아직 동기화하지 않았어요";
}

export function SettingsPanel({
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
        <span className="settings-section-label">동기화</span>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <strong>수동 동기화</strong>
              <span role={syncState === "failed" ? "alert" : undefined}>
                {getSyncDescription(syncState, lastSyncedText)}
              </span>
            </div>
            <button
              className="text-button"
              type="button"
              disabled={syncState === "syncing"}
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
            메모가 이 폴더에 파일로 저장됩니다. 폴더를 바꾸면 이후 저장부터
            적용됩니다.
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
