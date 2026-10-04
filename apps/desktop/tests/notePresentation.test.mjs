import assert from "node:assert/strict";
import test from "node:test";

import {
  countCharacters,
  filterNotes,
  getEmptyListMessage,
} from "../src/notePresentation.ts";

const notes = [
  {
    id: "one",
    title: "회의 메모",
    content: "오늘 확인할 내용",
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
    deletedAt: null,
    isPinned: false,
    schemaVersion: 1,
  },
  {
    id: "two",
    title: "초안",
    content: "English draft 123",
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
    deletedAt: null,
    isPinned: false,
    schemaVersion: 1,
  },
];

test("counts visible text and source line breaks while excluding markdown syntax", () => {
  assert.deepEqual(countCharacters(""), { withSpaces: 0, withoutSpaces: 0 });
  assert.deepEqual(countCharacters("가A1 나\tB\n다"), {
    withSpaces: 9,
    withoutSpaces: 6,
  });
  assert.deepEqual(countCharacters("# 제목\n- **항목**"), {
    withSpaces: 5,
    withoutSpaces: 4,
  });
  assert.deepEqual(countCharacters("**굵게**\n\n[링크](https://example.com)"), {
    withSpaces: 6,
    withoutSpaces: 4,
  });
  assert.deepEqual(countCharacters("- [x] 할 일\n- [ ] 다음"), {
    withSpaces: 6,
    withoutSpaces: 4,
  });
  assert.deepEqual(countCharacters('<strong style="color: red">가</strong>\n나'), {
    withSpaces: 3,
    withoutSpaces: 2,
  });
  assert.deepEqual(countCharacters("가  \n  \n나"), {
    withSpaces: 4,
    withoutSpaces: 2,
  });
  assert.deepEqual(countCharacters("##### 제목"), {
    withSpaces: 8,
    withoutSpaces: 7,
  });
  assert.deepEqual(countCharacters("```\n가\n```"), {
    withSpaces: 3,
    withoutSpaces: 1,
  });
  assert.deepEqual(countCharacters('<p style="color: red">가<br>나</p>'), {
    withSpaces: 3,
    withoutSpaces: 2,
  });
});

test("counts Unicode characters instead of UTF-16 code units", () => {
  assert.deepEqual(countCharacters("한🙂 글"), {
    withSpaces: 4,
    withoutSpaces: 3,
  });
});

test("searches titles and bodies case-insensitively", () => {
  assert.deepEqual(filterNotes(notes, " 회의 ").map((note) => note.id), ["one"]);
  assert.deepEqual(filterNotes(notes, "ENGLISH").map((note) => note.id), ["two"]);
  assert.deepEqual(filterNotes(notes, "123").map((note) => note.id), ["two"]);
  assert.deepEqual(filterNotes(notes, "찾을 수 없음"), []);
  assert.deepEqual(filterNotes(notes, "  "), notes);
});

test("distinguishes no notes from no search results", () => {
  assert.equal(getEmptyListMessage(0, ""), "메모가 없어요");
  assert.equal(getEmptyListMessage(0, "검색"), "메모가 없어요");
  assert.equal(getEmptyListMessage(2, "검색"), "검색 결과가 없어요");
});
