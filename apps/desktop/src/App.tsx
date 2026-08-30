import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ViewMode = "full" | "widget";

type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isPinned: boolean;
  schemaVersion: number;
};

const WINDOW_SIZES: Record<ViewMode, { width: number; height: number }> = {
  full: { width: 1080, height: 720 },
  widget: { width: 430, height: 520 },
};

const initialNotes: Note[] = [
  {
    id: "note-1",
    title: "오늘 회의 메모",
    content:
      "- MVP는 1-2주 안에\n- 글자수 카운터 필수\n- 상단 고정 먼저 구현\n\n작업 흐름 위에 가볍게 얹히는 작은 메모장.",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    deletedAt: null,
    isPinned: false,
    schemaVersion: 1,
  },
  {
    id: "note-2",
    title: "블로그 초안",
    content: "짧은 문장 글자수 확인",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    deletedAt: null,
    isPinned: false,
    schemaVersion: 1,
  },
  {
    id: "note-3",
    title: "할 일",
    content: "상단 고정 먼저 구현",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    deletedAt: null,
    isPinned: false,
    schemaVersion: 1,
  },
];

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
    schemaVersion: 1,
  };
}

function formatRelativeTime(note: Note) {
  if (note.id === "note-1") return "방금 전";
  if (note.id === "note-2") return "어제";
  if (note.id === "note-3") return "2일 전";

  return "방금 전";
}

function getNoteTitle(note: Note) {
  return note.title.trim() || "제목 없음";
}

function getPreview(note: Note) {
  return note.content.trim().split(/\s*\n+\s*/)[0] || "새 메모";
}

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState(initialNotes[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");

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

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) return notes;

    return notes.filter((note) => {
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
      );
    });
  }, [notes, searchQuery]);

  const counts = useMemo(
    () => ({
      withSpaces: countWithWhitespace(selectedNote?.content ?? ""),
      withoutSpaces: countWithoutWhitespace(selectedNote?.content ?? ""),
    }),
    [selectedNote?.content],
  );

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
  };

  const handleCreateNote = () => {
    const nextNote = createEmptyNote();

    setNotes((currentNotes) => [nextNote, ...currentNotes]);
    setSelectedNoteId(nextNote.id);
    setSearchQuery("");
    setViewMode("widget");
  };

  const handleCloseWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  if (viewMode === "widget") {
    return (
      <main className="app-shell widget-mode">
        <section className="widget-view" aria-label="위젯형 빠른 메모">
          <header className="app-header widget-header">
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
                onClick={handleCloseWindow}
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
            <span>저장 전</span>
            <span>
              공백 포함 {counts.withSpaces}자 · 제외 {counts.withoutSpaces}자
            </span>
          </div>

          <footer className="widget-footer">
            <button
              className="text-button"
              type="button"
              onClick={() => setViewMode("full")}
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
        <header className="app-header full-header">
          <h1 data-tauri-drag-region>전체 메모</h1>
          <div className="drag-region" data-tauri-drag-region />
          <div className="header-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => selectedNote && setViewMode("widget")}
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
              onClick={handleCloseWindow}
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
                  onClick={() => setSelectedNoteId(note.id)}
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
                <span>저장 전</span>
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
