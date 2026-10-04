type SettingsPanelProps = {
  storageDir: string | null;
  isFolderChangeAvailable: boolean;
  isChangingFolder: boolean;
  folderError: string | null;
  onChangeFolder: () => void;
};

export function SettingsPanel({
  storageDir,
  isFolderChangeAvailable,
  isChangingFolder,
  folderError,
  onChangeFolder,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="설정">
      <h2 className="settings-title">설정</h2>

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
