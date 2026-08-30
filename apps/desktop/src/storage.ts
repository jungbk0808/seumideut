import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const NOTE_STORE_SCHEMA_VERSION = 1;
export const NOTE_SCHEMA_VERSION = 1;
export const NOTE_STORE_CHANGED_EVENT = "note-store-changed";

export type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isPinned: boolean;
  schemaVersion: number;
};

export type NoteStore = {
  schemaVersion: number;
  notes: Note[];
  selectedNoteId: string | null;
};

const BROWSER_STORE_KEY = "memo-app:note-store";

export const emptyNoteStore: NoteStore = {
  schemaVersion: NOTE_STORE_SCHEMA_VERSION,
  notes: [],
  selectedNoteId: null,
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeNote(value: unknown): Note | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;

  const now = new Date().toISOString();

  return {
    id: value.id,
    title: toStringValue(value.title),
    content: toStringValue(value.content),
    createdAt: toStringValue(value.createdAt, now),
    updatedAt: toStringValue(value.updatedAt, now),
    deletedAt: toNullableString(value.deletedAt),
    isPinned: typeof value.isPinned === "boolean" ? value.isPinned : false,
    schemaVersion: NOTE_SCHEMA_VERSION,
  };
}

function normalizeNoteStore(value: unknown): NoteStore {
  if (!isRecord(value)) return emptyNoteStore;

  const notes = Array.isArray(value.notes)
    ? value.notes.flatMap((note) => {
        const normalizedNote = normalizeNote(note);

        return normalizedNote ? [normalizedNote] : [];
      })
    : [];
  const selectedNoteId =
    typeof value.selectedNoteId === "string" &&
    notes.some((note) => note.id === value.selectedNoteId)
      ? value.selectedNoteId
      : null;

  return {
    schemaVersion: NOTE_STORE_SCHEMA_VERSION,
    notes,
    selectedNoteId,
  };
}

export async function loadNoteStore(): Promise<NoteStore> {
  if (isTauriRuntime()) {
    return normalizeNoteStore(await invoke<NoteStore>("load_note_store"));
  }

  const storedValue = window.localStorage.getItem(BROWSER_STORE_KEY);

  if (!storedValue) return emptyNoteStore;

  return normalizeNoteStore(JSON.parse(storedValue));
}

export async function saveNoteStore(store: NoteStore): Promise<void> {
  const storeToSave = normalizeNoteStore(store);

  if (isTauriRuntime()) {
    await invoke("save_note_store", { store: storeToSave });
    await emit(NOTE_STORE_CHANGED_EVENT);
    return;
  }

  window.localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(storeToSave));
  window.dispatchEvent(new CustomEvent(NOTE_STORE_CHANGED_EVENT));
}
