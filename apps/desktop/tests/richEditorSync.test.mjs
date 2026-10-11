import assert from "node:assert/strict";
import test from "node:test";
import { createRichEditorSync } from "../src/richEditorSync.ts";

function setup(content = "- [ ] 위쪽\n- [ ] \n- [ ] 아래쪽") {
  const initial = content;
  let nativeComposing = false;
  const published = [];
  const replaced = [];
  const queued = new Set();
  const sync = createRichEditorSync(initial, {
    getContent: () => content,
    replaceContent: (next) => { content = next; replaced.push(next); },
    onChange: (next) => published.push(next),
    isComposing: () => nativeComposing,
    scheduleCommit: (commit) => { queued.add(commit); return () => queued.delete(commit); },
  });
  return {
    sync, initial, published, replaced,
    type(next) { content = next; sync.update(); },
    finalDOMContent(next) { content = next; },
    nativeComposition(value) { nativeComposing = value; },
    flush() { for (const commit of [...queued]) { queued.delete(commit); commit(); } },
  };
}

test("IME input stays in parent state without replacing the document with a stale snapshot", () => {
  const h = setup();
  h.sync.startComposition();
  h.nativeComposition(true);
  h.type("- [ ] 위쪽\n- [ ] ㅎ\n- [ ] 아래쪽");
  h.type("- [ ] 위쪽\n- [ ] 하\n- [ ] 아래쪽");
  h.sync.sync(h.initial + "\n");
  assert.equal(h.published.length, 2);
  assert.deepEqual(h.replaced, []);
  h.type("- [ ] 위쪽\n- [ ] 한글\n- [ ] 아래쪽");
  h.sync.endComposition();
  h.nativeComposition(false);
  assert.equal(h.published.length, 3);
  h.flush();
  assert.equal(h.published.length, 3);
  assert.equal(h.published.at(-1), "- [ ] 위쪽\n- [ ] 한글\n- [ ] 아래쪽");
  assert.deepEqual(h.replaced, []);
});

test("the deferred commit reads the final ProseMirror update after compositionend", () => {
  const h = setup("");
  h.sync.startComposition();
  h.type("하");
  h.sync.endComposition();
  h.finalDOMContent("한");
  h.flush();
  assert.deepEqual(h.published, ["하", "한"]);
  h.sync.update();
  h.sync.sync("한");
  assert.deepEqual(h.published, ["하", "한"]);
  assert.deepEqual(h.replaced, []);
});

test("a new IME composition cancels the previous pending commit", () => {
  const h = setup("");
  h.sync.startComposition(); h.type("한"); h.sync.endComposition();
  h.sync.startComposition(); h.type("한ㄱ"); h.flush();
  assert.deepEqual(h.published, ["한", "한ㄱ"]);
  h.type("한글"); h.sync.endComposition(); h.flush();
  assert.deepEqual(h.published, ["한", "한ㄱ", "한글"]);
  assert.deepEqual(h.replaced, []);
});

test("ordinary edits publish immediately and their parent echo never replaces the document", () => {
  const h = setup("처음");
  h.type("변경");
  h.sync.sync("변경");
  assert.deepEqual(h.published, ["변경"]);
  assert.deepEqual(h.replaced, []);
});

test("external updates still load when no composition is in progress", () => {
  const h = setup("처음");
  h.sync.sync("다른 창에서 수정");
  assert.deepEqual(h.replaced, ["다른 창에서 수정"]);
  h.sync.update();
  assert.deepEqual(h.published, []);
});

test("an external update deferred during a cancelled composition is eventually loaded", () => {
  const h = setup("처음");
  h.sync.startComposition();
  h.sync.sync("외부 수정");
  assert.deepEqual(h.replaced, []);
  h.sync.endComposition(); h.flush();
  assert.deepEqual(h.replaced, ["외부 수정"]);
  assert.deepEqual(h.published, []);
});

test("switching notes flushes the old note once and cancels its queued callback", () => {
  const h = setup("");
  h.sync.startComposition(); h.type("이전 메모 입력"); h.sync.endComposition();
  h.sync.dispose(); h.flush(); h.sync.dispose();
  h.type("다른 메모"); h.sync.sync("다른 메모");
  assert.deepEqual(h.published, ["이전 메모 입력"]);
  assert.deepEqual(h.replaced, []);
});

test("the native composition flag blocks incoming replacement before compositionstart is handled", () => {
  const h = setup("");
  h.nativeComposition(true); h.type("ㅎ"); h.sync.sync("외부 내용");
  assert.deepEqual(h.published, ["ㅎ"]);
  assert.deepEqual(h.replaced, []);
  h.nativeComposition(false); h.sync.endComposition(); h.type("한"); h.flush();
  assert.deepEqual(h.published, ["ㅎ", "한"]);
  assert.deepEqual(h.replaced, []);
});
