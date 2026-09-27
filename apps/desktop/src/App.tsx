import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { CodeXml, Newspaper, Pin, Plus, Search, Trash2, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Note,
  type NoteStore,
  NOTE_STORE_CHANGED_EVENT,
  NOTE_SCHEMA_VERSION,
  emptyNoteStore,
  loadNoteStore,
  saveNoteStore,
} from "./storage";
import { MarkdownRichEditor } from "./MarkdownRichEditor";
import {
  WIDGET_NAVIGATE_EVENT,
  openFullMemoWindow,
  openWidgetMemoWindow,
} from "./windows";

type ViewMode = "full" | "widget";
type MarkdownViewMode = "preview" | "source";
type SaveStatus = "loading" | "idle" | "saving" | "saved" | "failed";
type LaunchContext = {
  viewMode: ViewMode;
  requestedNoteId: string | null;
  forceNewNote: boolean;
};

const WINDOW_SIZES: Record<ViewMode, { width: number; height: number }> = {
  full: { width: 1080, height: 720 },
  widget: { width: 430, height: 520 },
};

function countWithoutWhitespace(value: string) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function countWithWhitespace(value: string) {
  return Array.from(value).length;
}

function createEmptyNote(): Note {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isPinned: false,
    schemaVersion: NOTE_SCHEMA_VERSION,
  };
}

function getLaunchContext(): LaunchContext {
  const params = new URLSearchParams(window.location.search);

  return {
    viewMode: params.get("view") === "full" ? "full" : "widget",
    requestedNoteId: params.get("noteId"),
    forceNewNote: params.get("new") === "1",
  };
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isPersistableNote(note: Note) {
  return Boolean(note.title.trim() || note.content.trim());
}

function sortByUpdatedAt(notes: Note[]) {
  return [...notes].sort(
    (firstNote, secondNote) =>
      new Date(secondNote.updatedAt).getTime() -
      new Date(firstNote.updatedAt).getTime(),
  );
}

function formatRelativeTime(note: Note) {
  const updatedTime = new Date(note.updatedAt).getTime();
  const diffInMs = Date.now() - updatedTime;

  if (!Number.isFinite(updatedTime) || diffInMs < 60_000) return "방금 전";

  const diffInMinutes = Math.floor(diffInMs / 60_000);
  if (diffInMinutes < 60) return `${diffInMinutes}분 전`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}시간 전`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) return "어제";

  return `${diffInDays}일 전`;
}

function getNoteTitle(note: Note) {
  return note.title.trim() || "제목 없음";
}

function getPreview(note: Note) {
  return note.content.trim().split(/\s*\n+\s*/)[0] || "새 메모";
}

function getSaveStatusText(saveStatus: SaveStatus) {
  if (saveStatus === "loading") return "불러오는 중...";
  if (saveStatus === "saving") return "저장 중...";
  if (saveStatus === "saved") return "저장됨";
  if (saveStatus === "failed") return "저장 실패 · 재시도";

  return "저장 전";
}

function MarkdownViewToggle({
  mode,
  onModeChange,
}: {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
}) {
  return (
    <div className="view-toggle" aria-label="마크다운 보기 방식">
      <button
        className={mode === "preview" ? "selected" : ""}
        type="button"
        aria-label="미리보기"
        title="미리보기"
        onClick={() => onModeChange("preview")}
      >
        <Newspaper size={16} aria-hidden="true" />
      </button>
      <button
        className={mode === "source" ? "selected" : ""}
        type="button"
        aria-label="코드 보기"
        title="코드 보기"
        onClick={() => onModeChange("source")}
      >
        <CodeXml size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function toPersistableStore(notes: Note[], selectedNoteId: string): NoteStore {
  const persistableNotes = sortByUpdatedAt(
    notes.filter(
      (note) =>
        note.deletedAt !== null ||
        isPersistableNote(note) ||
        note.id === selectedNoteId,
    ),
  );
  const activePersistableNotes = persistableNotes.filter(
    (note) => note.deletedAt === null,
  );
  const persistableSelectedNoteId = activePersistableNotes.some(
    (note) => note.id === selectedNoteId,
  )
    ? selectedNoteId
    : (activePersistableNotes[0]?.id ?? null);

  return {
    ...emptyNoteStore,
    notes: persistableNotes,
    selectedNoteId: persistableSelectedNoteId,
  };
}

function DeleteConfirmationModal({
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: {
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !isDeleting) {
      event.preventDefault();
      onCancel();
    }

    if (event.key === "Tab") {
      const target = event.shiftKey
        ? cancelButtonRef.current
        : confirmButtonRef.current;
      if (document.activeElement === target) {
        event.preventDefault();
        (event.shiftKey
          ? confirmButtonRef.current
          : cancelButtonRef.current
        )?.focus();
      }
    }
  };

  return (
    <div
      className="delete-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <div
        className="delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        aria-describedby="delete-modal-description"
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-modal-title">메모를 삭제할까요?</h2>
        <p id="delete-modal-description">
          삭제하면 목록에서 사라져요.
          <br />
          MVP에서는 복구를 지원하지 않을 수 있어요.
        </p>
        {error && (
          <p className="delete-modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="delete-modal-actions">
          <button
            ref={cancelButtonRef}
            className="text-button"
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
          >
            취소
          </button>
          <button
            ref={confirmButtonRef}
            className="danger-button"
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [launchContext] = useState(getLaunchContext);
  const viewMode = launchContext.viewMode;
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [markdownViewMode, setMarkdownViewMode] =
    useState<MarkdownViewMode>("preview");
  const [hasLoadedStore, setHasLoadedStore] = useState(false);
  const [hasPendingSave, setHasPendingSave] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveVersionRef = useRef(0);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const widgetTitleRef = useRef<HTMLInputElement>(null);
  const widgetNavigateRef = useRef<(noteId: string | null) => Promise<void>>(
    async () => {},
  );
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    let isMounted = true;

    const restoreStore = async () => {
      try {
        const store = await loadNoteStore();
        const restoredNotes = sortByUpdatedAt(
          store.notes.filter((note) => note.deletedAt === null),
        );
        const fallbackSelectedNoteId =
          launchContext.requestedNoteId ?? store.selectedNoteId ?? restoredNotes[0]?.id;
        const shouldCreateDraft =
          launchContext.viewMode === "widget" &&
          (launchContext.forceNewNote || restoredNotes.length === 0);
        const draftNote = shouldCreateDraft ? createEmptyNote() : null;
        const startupNotes = draftNote ? [draftNote, ...restoredNotes] : restoredNotes;
        const startupSelectedNoteId = draftNote
          ? draftNote.id
          : (startupNotes.find((note) => note.id === fallbackSelectedNoteId)
              ?.id ?? startupNotes[0]?.id ?? "");

        if (!isMounted) return;

        setNotes(startupNotes);
        setSelectedNoteId(startupSelectedNoteId);
        setSaveStatus(restoredNotes.length > 0 ? "saved" : "idle");
      } catch {
        const fallbackNote = createEmptyNote();

        if (!isMounted) return;

        setNotes([fallbackNote]);
        setSelectedNoteId(fallbackNote.id);
        setSaveStatus("failed");
      } finally {
        if (isMounted) {
          setHasLoadedStore(true);
        }
      }
    };

    void restoreStore();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedStore) return;

    let unlistenTauriEvent: (() => void) | null = null;
    let isSubscribed = true;

    const reloadStoredNotes = async () => {
      try {
        const store = await loadNoteStore();
        if (!isSubscribed) return;

        if (hasPendingSave) {
          const deletedIds = new Set(
            store.notes
              .filter((note) => note.deletedAt !== null)
              .map((note) => note.id),
          );
          if (deletedIds.size === 0) return;

          const remainingNotes = notesRef.current.filter(
            (note) => !deletedIds.has(note.id),
          );
          setNotes(remainingNotes);
          if (deletedIds.has(selectedNoteId)) {
            setSelectedNoteId(sortByUpdatedAt(remainingNotes)[0]?.id ?? "");
          }
          return;
        }

        const restoredNotes = sortByUpdatedAt(
          store.notes.filter((note) => note.deletedAt === null),
        );
        const fallbackSelectedNoteId =
          selectedNoteId ||
          launchContext.requestedNoteId ||
          store.selectedNoteId ||
          restoredNotes[0]?.id;
        const nextSelectedNoteId =
          restoredNotes.find((note) => note.id === fallbackSelectedNoteId)?.id ??
          restoredNotes[0]?.id ??
          "";

        if (!isSubscribed) return;

        setNotes(restoredNotes);
        setSelectedNoteId(nextSelectedNoteId);
      } catch {
        if (isSubscribed) {
          setSaveStatus("failed");
        }
      }
    };

    const handleBrowserStorageChange = () => {
      void reloadStoredNotes();
    };

    if (isTauriRuntime()) {
      void listen(NOTE_STORE_CHANGED_EVENT, () => {
        void reloadStoredNotes();
      }).then((unlisten) => {
        unlistenTauriEvent = unlisten;
      });
    }

    window.addEventListener(
      NOTE_STORE_CHANGED_EVENT,
      handleBrowserStorageChange,
    );
    window.addEventListener("storage", handleBrowserStorageChange);

    return () => {
      isSubscribed = false;
      unlistenTauriEvent?.();
      window.removeEventListener(
        NOTE_STORE_CHANGED_EVENT,
        handleBrowserStorageChange,
      );
      window.removeEventListener("storage", handleBrowserStorageChange);
    };
  }, [
    hasLoadedStore,
    hasPendingSave,
    launchContext.requestedNoteId,
    selectedNoteId,
  ]);

  useEffect(() => {
    if (viewMode !== "full") return;

    let unlistenSelectEvent: (() => void) | null = null;
    let isSubscribed = true;

    if (isTauriRuntime()) {
      void listen<{ noteId: string }>("memo-select-note", ({ payload }) => {
        if (isSubscribed && payload.noteId) {
          setSelectedNoteId(payload.noteId);
        }
      }).then((unlisten) => {
        unlistenSelectEvent = unlisten;
      });
    }

    return () => {
      isSubscribed = false;
      unlistenSelectEvent?.();
    };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "widget" || !isTauriRuntime()) return;

    let isSubscribed = true;
    let unlistenNavigateEvent: (() => void) | null = null;

    void listen<{ noteId: string | null }>(WIDGET_NAVIGATE_EVENT, ({ payload }) => {
      if (isSubscribed) {
        void widgetNavigateRef.current(payload.noteId);
      }
    }).then((unlisten) => {
      if (isSubscribed) unlistenNavigateEvent = unlisten;
      else unlisten();
    });

    return () => {
      isSubscribed = false;
      unlistenNavigateEvent?.();
    };
  }, [viewMode]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      window.name = viewMode === "full" ? "memo-full" : "memo-widget";
    }
  }, [viewMode]);

  useEffect(() => {
    const resizeWindow = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const size = WINDOW_SIZES[viewMode];

        await currentWindow.setSize(new LogicalSize(size.width, size.height));
        await currentWindow.center();
      } catch {
        // Browser-only development does not expose the Tauri window API.
      }
    };

    void resizeWindow();
  }, [viewMode]);

  useEffect(() => {
    if (!hasLoadedStore || !hasPendingSave || deleteTargetId !== null) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveStatus("saving");

    const saveVersion = saveVersionRef.current + 1;
    saveVersionRef.current = saveVersion;

    saveTimerRef.current = window.setTimeout(() => {
      const store = toPersistableStore(notes, selectedNoteId);

      void saveNoteStore(store)
        .then(() => {
          if (saveVersionRef.current !== saveVersion) return;

          setSaveStatus("saved");
          setHasPendingSave(false);
        })
        .catch(() => {
          if (saveVersionRef.current !== saveVersion) return;

          setSaveStatus("failed");
        });
    }, 500);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    deleteTargetId,
    hasLoadedStore,
    hasPendingSave,
    notes,
    saveAttempt,
    selectedNoteId,
  ]);

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const activeNotes = useMemo(
    () => sortByUpdatedAt(notes.filter((note) => note.deletedAt === null)),
    [notes],
  );

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) return activeNotes;

    return activeNotes.filter((note) => {
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
      );
    });
  }, [activeNotes, searchQuery]);

  const counts = useMemo(
    () => ({
      withSpaces: countWithWhitespace(selectedNote?.content ?? ""),
      withoutSpaces: countWithoutWhitespace(selectedNote?.content ?? ""),
    }),
    [selectedNote?.content],
  );

  const markStoreDirty = () => {
    setHasPendingSave(true);
    setSaveStatus("saving");
  };

  const updateSelectedNote = (updates: Partial<Pick<Note, "title" | "content">>) => {
    if (!selectedNote) return;

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : note,
      ),
    );
    markStoreDirty();
  };

  const handleCreateNote = () => {
    if (viewMode === "widget") {
      void widgetNavigateRef.current(null);
      return;
    }

    void openWidgetMemoWindow();
  };

  const handleSelectNote = (noteId: string) => {
    setSelectedNoteId(noteId);
    setHasPendingSave(true);
  };

  const handleRetrySave = () => {
    setHasPendingSave(true);
    setSaveAttempt((currentAttempt) => currentAttempt + 1);
  };

  const handleOpenDeleteModal = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selectedNote) return;

    deleteTriggerRef.current = event.currentTarget;
    setDeleteError(null);
    setDeleteTargetId(selectedNote.id);
  };

  const handleCancelDelete = () => {
    setDeleteTargetId(null);
    setDeleteError(null);
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  };

  const handleConfirmDelete = async () => {
    const targetNote = notes.find((note) => note.id === deleteTargetId);
    if (!targetNote || isDeleting) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveVersionRef.current += 1;

    const deletedAt = new Date().toISOString();
    const nextNotes = notes.map((note) =>
      note.id === targetNote.id
        ? { ...note, deletedAt, updatedAt: deletedAt }
        : note,
    );
    const nextActiveNotes = sortByUpdatedAt(
      nextNotes.filter((note) => note.deletedAt === null),
    );
    const nextSelectedNoteId =
      selectedNoteId === targetNote.id
        ? (nextActiveNotes[0]?.id ?? "")
        : selectedNoteId;

    setIsDeleting(true);
    setDeleteError(null);
    setSaveStatus("saving");

    try {
      await saveNoteStore(toPersistableStore(nextNotes, nextSelectedNoteId));
      setNotes(nextNotes);
      setSelectedNoteId(nextSelectedNoteId);
      setHasPendingSave(false);
      setSaveStatus("saved");
      setDeleteTargetId(null);
    } catch {
      setSaveStatus("failed");
      setDeleteError("메모를 삭제하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setIsDeleting(false);
    }
  };

  const persistCurrentStore = async () => {
    if (!hasLoadedStore) return false;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    try {
      setSaveStatus("saving");
      await saveNoteStore(toPersistableStore(notes, selectedNoteId));
      setHasPendingSave(false);
      setSaveStatus("saved");
      return true;
    } catch {
      setSaveStatus("failed");
      return false;
    }
  };

  widgetNavigateRef.current = async (noteId) => {
    if (!hasLoadedStore || noteId === selectedNoteId) return;
    if (hasPendingSave && !(await persistCurrentStore())) return;

    if (noteId === null) {
      const draftNote = createEmptyNote();
      setNotes((currentNotes) => [draftNote, ...currentNotes]);
      setSelectedNoteId(draftNote.id);
      setSaveStatus("idle");
      window.requestAnimationFrame(() => widgetTitleRef.current?.focus());
      return;
    }

    try {
      const store = await loadNoteStore();
      const restoredNotes = sortByUpdatedAt(
        store.notes.filter((note) => note.deletedAt === null),
      );
      if (!restoredNotes.some((note) => note.id === noteId)) return;

      setNotes(restoredNotes);
      setSelectedNoteId(noteId);
      setSaveStatus("saved");
      window.requestAnimationFrame(() => widgetTitleRef.current?.focus());
    } catch {
      setSaveStatus("failed");
    }
  };

  const handleOpenFullMemoWindow = async () => {
    if (hasPendingSave && !(await persistCurrentStore())) return;

    await openFullMemoWindow(selectedNote?.id);
  };

  const handleOpenSelectedWidgetWindow = async () => {
    if (hasPendingSave && !(await persistCurrentStore())) return;

    await openWidgetMemoWindow(selectedNote?.id);
  };

  const handleCloseWindow = async () => {
    if (hasPendingSave && !(await persistCurrentStore())) return;

    try {
      await getCurrentWindow().destroy();
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        window.close();
      }
    }
  };

  const handleStartWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isTauriRuntime() || event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea")) return;

    void getCurrentWindow().startDragging();
  };

  const handleBrowserCloseWindow = () => {
    if (!isTauriRuntime()) {
      window.close();
    }
  };

  const saveStatusContent =
    saveStatus === "failed" ? (
      <button
        className="status-retry-button"
        type="button"
        onClick={handleRetrySave}
      >
        {getSaveStatusText(saveStatus)}
      </button>
    ) : (
      <span>{getSaveStatusText(saveStatus)}</span>
    );

  const deleteModal = deleteTargetId && (
    <DeleteConfirmationModal
      isDeleting={isDeleting}
      error={deleteError}
      onCancel={handleCancelDelete}
      onConfirm={() => {
        void handleConfirmDelete();
      }}
    />
  );

  if (viewMode === "widget") {
    return (
      <main className="app-shell widget-mode">
        <section className="widget-view" aria-label="위젯형 빠른 메모">
          <header
            className="app-header widget-header"
            data-tauri-drag-region
            onPointerDown={handleStartWindowDrag}
          >
            <h1 data-tauri-drag-region>Memo</h1>
            <div className="drag-region" data-tauri-drag-region />
            <div className="header-actions">
              <button className="icon-button" type="button" aria-label="상단 고정">
                <Pin size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="새 메모"
                onClick={handleCreateNote}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button close-button"
                type="button"
                aria-label="닫기"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  void handleCloseWindow();
                  handleBrowserCloseWindow();
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="widget-editor">
            {selectedNote ? (
              <>
                <input
                  ref={widgetTitleRef}
                  className="widget-title-input"
                  value={selectedNote.title}
                  onChange={(event) =>
                    updateSelectedNote({ title: event.target.value })
                  }
                  placeholder="제목 없음"
                  aria-label="메모 제목"
                  autoFocus
                />
                <div className="widget-body-shell">
                  <MarkdownRichEditor
                    className="widget-markdown-editor"
                    content={selectedNote.content}
                    onChange={(content) => updateSelectedNote({ content })}
                  />
                </div>
              </>
            ) : (
              <div className="empty-widget">
                <p>아직 메모가 없어요.</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={handleCreateNote}
                >
                  새 메모 만들기
                </button>
              </div>
            )}
          </div>

          <div className="status-row" aria-live="polite">
            {saveStatusContent}
            <span>
              공백 포함 {counts.withSpaces}자 · 제외 {counts.withoutSpaces}자
            </span>
          </div>

          <footer className="widget-footer">
            <button
              className="text-button"
              type="button"
              onClick={() => {
                void handleOpenFullMemoWindow();
              }}
            >
              전체 메모 열기
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={handleOpenDeleteModal}
              disabled={!selectedNote}
            >
              삭제
            </button>
          </footer>
        </section>
        {deleteModal}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="full-view" aria-label="전체 메모 관리">
        <header
          className="app-header full-header"
          data-tauri-drag-region
          onPointerDown={handleStartWindowDrag}
        >
          <h1 data-tauri-drag-region>전체 메모</h1>
          <div className="drag-region" data-tauri-drag-region />
          <div className="header-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => {
                void handleOpenSelectedWidgetWindow();
              }}
            >
              위젯으로
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="새 메모"
              title="새 메모"
              onClick={handleCreateNote}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button close-button"
              type="button"
              aria-label="닫기"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                void handleCloseWindow();
                handleBrowserCloseWindow();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <aside className="memo-sidebar">
          <label className="field-label" htmlFor="memo-search">
            메모 검색
          </label>
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              id="memo-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="검색어 입력"
            />
          </div>

          <div className="list-label">최근 수정순</div>
          <div className="memo-list" aria-label="메모 목록">
            {filteredNotes.length > 0 ? (
              filteredNotes.map((note) => (
                <button
                  className={`memo-list-item ${
                    note.id === selectedNoteId ? "selected" : ""
                  }`}
                  type="button"
                  key={note.id}
                  onClick={() => handleSelectNote(note.id)}
                >
                  <strong>{getNoteTitle(note)}</strong>
                  <span>{formatRelativeTime(note)}</span>
                  <small>{getPreview(note)}</small>
                </button>
              ))
            ) : (
              <p className="empty-list">검색 결과가 없어요</p>
            )}
          </div>
        </aside>

        <section className="full-editor" aria-label="선택한 메모 편집">
          {selectedNote ? (
            <>
              <label className="field-label" htmlFor="full-title">
                제목
              </label>
              <input
                id="full-title"
                className="full-title-input"
                value={selectedNote.title}
                onChange={(event) =>
                  updateSelectedNote({ title: event.target.value })
                }
                placeholder="제목 없음"
              />

              <span className="field-label body-label">본문</span>

              {markdownViewMode === "source" ? (
                <textarea
                  id="full-body"
                  className="full-body-input"
                  value={selectedNote.content}
                  onChange={(event) =>
                    updateSelectedNote({ content: event.target.value })
                  }
                  placeholder="여기에 바로 메모를 입력하세요."
                />
              ) : (
                <MarkdownRichEditor
                  className="full-body-preview"
                  content={selectedNote.content}
                  onChange={(content) => updateSelectedNote({ content })}
                  editorId="full-body"
                />
              )}

              <div className="editor-actions">
                <MarkdownViewToggle
                  mode={markdownViewMode}
                  onModeChange={setMarkdownViewMode}
                />

                <button
                  className="full-delete-button"
                  type="button"
                  onClick={handleOpenDeleteModal}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  삭제
                </button>
              </div>

              <div className="full-status-row" aria-live="polite">
                {saveStatusContent}
                <span>
                  공백 포함 {counts.withSpaces}자 · 제외 {counts.withoutSpaces}자
                </span>
              </div>
            </>
          ) : (
            <div className="empty-editor">
              <p>아직 선택된 메모가 없어요.</p>
              <button className="text-button" type="button" onClick={handleCreateNote}>
                새 메모 만들기
              </button>
            </div>
          )}
        </section>
      </section>
      {deleteModal}
    </main>
  );
}
