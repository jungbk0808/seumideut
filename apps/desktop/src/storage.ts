import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

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
export const NOTE_STORE_CHANGED_EVENT = "note-store-changed";

export const emptyNoteStore: NoteStore = {
  schemaVersion: 1,
  notes: [],
  selectedNoteId: null,
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadNoteStore(): Promise<NoteStore> {
  if (isTauriRuntime()) {
    return invoke<NoteStore>("load_note_store");
  }

  const storedValue = window.localStorage.getItem(BROWSER_STORE_KEY);

  if (!storedValue) return emptyNoteStore;

  return JSON.parse(storedValue) as NoteStore;
}

export async function saveNoteStore(store: NoteStore): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_note_store", { store });
    await emit(NOTE_STORE_CHANGED_EVENT);
    return;
  }

  window.localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(NOTE_STORE_CHANGED_EVENT));
}
