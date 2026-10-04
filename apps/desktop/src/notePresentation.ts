import type { Note } from "./storage";

export function countCharacters(content: string) {
  return {
    withSpaces: Array.from(content).length,
    withoutSpaces: Array.from(content.replace(/\s/g, "")).length,
  };
}

export function filterNotes(notes: Note[], searchQuery: string): Note[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return notes;

  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query),
  );
}

export function getEmptyListMessage(noteCount: number, searchQuery: string) {
  if (noteCount === 0) return "메모가 없어요";
  return searchQuery.trim() ? "검색 결과가 없어요" : "메모가 없어요";
}
