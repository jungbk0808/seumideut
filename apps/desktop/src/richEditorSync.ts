type RichEditorSyncOptions = {
  getContent: () => string;
  replaceContent: (content: string) => void;
  onChange: (content: string) => void;
  isComposing: () => boolean;
  scheduleCommit?: (commit: () => void) => () => void;
};

export function createRichEditorSync(
  initialContent: string,
  options: RichEditorSyncOptions,
) {
  let lastContent = initialContent;
  let compositionActive = false;
  let pendingContent: string | null = null;
  let compositionChanged = false;
  let disposed = false;
  let cancelCommit: (() => void) | null = null;
  const scheduleCommit = options.scheduleCommit ?? ((commit: () => void) => {
    const timer = setTimeout(commit, 0);
    return () => clearTimeout(timer);
  });
  const isBlocked = () => compositionActive || options.isComposing();
  const publish = () => {
    const content = options.getContent();
    if (content === lastContent) return;
    if (isBlocked()) compositionChanged = true;
    lastContent = content;
    options.onChange(content);
  };

  return {
    update() {
      // Keep the parent state current for autosave and window-close persistence.
      if (!disposed) publish();
    },
    sync(content: string) {
      if (disposed) return;
      if (isBlocked()) {
        pendingContent = content;
        return;
      }
      if (content === lastContent) return;
      const currentContent = options.getContent();
      lastContent = content;
      if (content !== currentContent) options.replaceContent(content);
    },
    startComposition() {
      if (disposed) return;
      cancelCommit?.();
      cancelCommit = null;
      if (!compositionActive && !options.isComposing()) compositionChanged = false;
      compositionActive = true;
    },
    endComposition() {
      if (disposed) return;
      cancelCommit?.();
      // ProseMirror flushes the final IME DOM changes after compositionend.
      // Keep incoming document replacements blocked until that flush completes.
      cancelCommit = scheduleCommit(() => {
        cancelCommit = null;
        const changed = compositionChanged || options.getContent() !== lastContent;
        compositionActive = false;
        if (disposed || isBlocked()) return;
        const incoming = pendingContent;
        pendingContent = null;
        compositionChanged = false;
        if (!changed && incoming !== null) {
          const currentContent = options.getContent();
          lastContent = incoming;
          if (incoming !== currentContent) options.replaceContent(incoming);
        } else {
          publish();
        }
      });
    },
    dispose() {
      if (disposed) return;
      cancelCommit?.();
      cancelCommit = null;
      // A note switch can unmount us before the deferred commit runs.
      if (compositionActive) publish();
      disposed = true;
    },
  };
}
