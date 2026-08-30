import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Pin, Plus, Search, Trash2, X } from "lucide-react";
import {
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
import { openFullMemoWindow, openWidgetMemoWindow } from "./windows";

type ViewMode = "full" | "widget";
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

function toPersistableStore(notes: Note[], selectedNoteId: string): NoteStore {
  const persistableNotes = sortByUpdatedAt(
    notes.filter(
      (note) =>
        note.deletedAt !== null ||
        isPersistableNote(note) ||
        note.id === selectedNoteId,
    ),
  );
  const persistableSelectedNoteId = persistableNotes.some(
    (note) => note.id === selectedNoteId,
  )
    ? selectedNoteId
    : (persistableNotes[0]?.id ?? null);

  return {
    ...emptyNoteStore,
    notes: persistableNotes,
    selectedNoteId: persistableSelectedNoteId,
  };
}

export default function App() {
  const [launchContext] = useState(getLaunchContext);
  const viewMode = launchContext.viewMode;
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [hasLoadedStore, setHasLoadedStore] = useState(false);
  const [hasPendingSave, setHasPendingSave] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const saveVersionRef = useRef(0);

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
          : startupNotes.find((note) => note.id === fallbackSelectedNoteId)?.id ?? "";

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
      if (hasPendingSave) return;

      try {
        const store = await loadNoteStore();
        const restoredNotes = sortByUpdatedAt(
          store.notes.filter((note) => note.deletedAt === null),
        );
        const fallbackSelectedNoteId =
          selectedNoteId ||
          launchContext.requestedNoteId ||
          store.selectedNoteId ||
          restoredNotes[0]?.id;
        const nextSelectedNoteId =
          restoredNotes.find((note) => note.id === fallbackSelectedNoteId)?.id ?? "";

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
    if (!hasLoadedStore || !hasPendingSave) return;

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
  }, [hasLoadedStore, hasPendingSave, notes, saveAttempt, selectedNoteId]);

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

  const persistCurrentStore = async () => {
    if (!hasLoadedStore) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    try {
      setSaveStatus("saving");
      await saveNoteStore(toPersistableStore(notes, selectedNoteId));
      setHasPendingSave(false);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  };

  const handleOpenFullMemoWindow = async () => {
    if (hasPendingSave) {
      await persistCurrentStore();
    }

    await openFullMemoWindow(selectedNote?.id);
  };

  const handleOpenSelectedWidgetWindow = async () => {
    if (hasPendingSave) {
      await persistCurrentStore();
    }

    await openWidgetMemoWindow(selectedNote?.id);
  };

  const handleCloseWindow = async () => {
    if (hasPendingSave) {
      await persistCurrentStore();
    }

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
            <input
              className="widget-title-input"
              value={selectedNote?.title ?? ""}
              onChange={(event) => updateSelectedNote({ title: event.target.value })}
              placeholder="제목 없음"
              aria-label="메모 제목"
              autoFocus
            />
            <textarea
              className="widget-body-input"
              value={selectedNote?.content ?? ""}
              onChange={(event) => updateSelectedNote({ content: event.target.value })}
              placeholder="여기에 바로 메모를 입력하세요."
              aria-label="메모 본문"
            />
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
            <button className="danger-button" type="button">
              삭제
            </button>
          </footer>
        </section>
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
            <button className="text-button" type="button">
              항상 위
            </button>
            <button className="text-button" type="button" onClick={handleCreateNote}>
              새 메모
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
                제목 입력
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

              <label className="field-label body-label" htmlFor="full-body">
                본문
              </label>
              <textarea
                id="full-body"
                className="full-body-input"
                value={selectedNote.content}
                onChange={(event) =>
                  updateSelectedNote({ content: event.target.value })
                }
                placeholder="여기에 바로 메모를 입력하세요."
              />

              <div className="full-status-row" aria-live="polite">
                {saveStatusContent}
                <span>
                  공백 포함 {counts.withSpaces}자 · 제외 {counts.withoutSpaces}자
                </span>
              </div>

              <button className="full-delete-button" type="button">
                <Trash2 size={14} aria-hidden="true" />
                삭제
              </button>
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
    </main>
  );
}
