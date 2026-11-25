import { decodeHtmlEntities } from "@tiptap/core";
import { marked, type Token } from "marked";
import type { Note } from "./storage";

function plainTextFromTokens(tokens: Token[]): { text: string; htmlBreaks: number } {
  let text = "";
  let htmlBreaks = 0;

  for (const [index, token] of tokens.entries()) {
    const start = text.length;
    if (token.type === "list_item" && !token.task && /^\[[ xX]\][ \t]*(?=\n|$)/.test(token.text)) {
      // marked leaves an empty parent's checkbox as text, even when it has
      // nested items. Remove only that marker and keep counting its children.
      const result = plainTextFromTokens(marked.lexer(
        token.text.replace(/^\[[ xX]\][ \t]*/, ""),
        { gfm: true, breaks: true },
      ));
      text += result.text;
      htmlBreaks += result.htmlBreaks;
    } else if (token.type === "list") {
      const result = plainTextFromTokens(token.items);
      text += result.text;
      htmlBreaks += result.htmlBreaks;
    } else if (token.type === "heading" && token.depth >= 5) {
      // These levels stay literal in the editor, including their hash marks.
      text += token.raw.replace(/\n+$/, "");
    } else if (token.type === "table") {
      const cells = [...token.header, ...token.rows.flat()];
      for (const cell of cells) {
        const result = plainTextFromTokens(cell.tokens);
        text += result.text;
        htmlBreaks += result.htmlBreaks;
      }
    } else if (token.type === "html") {
      const html = token.raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
      htmlBreaks += (html.match(/<br\s*\/?>/gi) ?? []).length;
      text += decodeHtmlEntities(
        html.replace(/<!--[^]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ""),
      );
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      const result = plainTextFromTokens(token.tokens);
      text += result.text;
      htmlBreaks += result.htmlBreaks;
    } else if (token.type === "code" || token.type === "codespan" ||
      token.type === "escape" || token.type === "text") {
      text += decodeHtmlEntities(token.text);
    }

    // Legacy Markdown hard breaks can leave two syntax spaces before a blank line.
    if (tokens[index + 1]?.type === "space") {
      text = text.slice(0, start) + text.slice(start).replace(/ {2,}$/, "");
    }
  }

  return { text, htmlBreaks };
}

function listSpacingBreaks(tokens: Token[]): number {
  let breaks = 0;
  for (const token of tokens) {
    if (token.type === "list") {
      // Blank source lines between sibling items control loose-list layout;
      // the rendered checklist still has one line boundary per item.
      for (const item of token.items.slice(0, -1)) {
        const trailingBreaks = item.raw.match(/\n+$/)?.[0].length ?? 0;
        breaks += Math.max(0, trailingBreaks - 1);
      }
      breaks += listSpacingBreaks(token.items);
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      breaks += listSpacingBreaks(token.tokens);
    }
  }
  return breaks;
}

export function countCharacters(content: string) {
  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const tokens = marked.lexer(normalizedContent, { gfm: true, breaks: true });
  const { text, htmlBreaks } = plainTextFromTokens(tokens);
  const visibleText = text.replace(/\n/g, "");
  const lineBreaks = (normalizedContent.match(/\n/g) ?? []).length + htmlBreaks
    - listSpacingBreaks(tokens);

  return {
    withSpaces: Array.from(visibleText).length + lineBreaks,
    withoutSpaces: Array.from(visibleText.replace(/\s/g, "")).length,
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
