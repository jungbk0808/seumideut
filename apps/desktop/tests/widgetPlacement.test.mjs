import assert from "node:assert/strict";
import test from "node:test";

import {
  findAdjacentWidgetPosition,
  findWidgetShowingNote,
} from "../src/widgetPlacement.ts";

const workArea = { x: 0, y: 0, width: 1600, height: 900 };
const widgetSize = { width: 350, height: 420 };

test("reuses only a widget already showing the requested memo", () => {
  const widgets = [
    { label: "main", noteId: "memo-one" },
    { label: "widget-two", noteId: "memo-two" },
  ];

  assert.equal(findWidgetShowingNote(widgets, "memo-two"), "widget-two");
  assert.equal(findWidgetShowingNote(widgets, "memo-three"), null);
});

test("places another memo beside existing widgets without overlap", () => {
  const first = { x: 100, y: 100, ...widgetSize };
  const second = { x: 462, y: 100, ...widgetSize };

  assert.deepEqual(
    findAdjacentWidgetPosition(first, [first, second], workArea, widgetSize, 12),
    { x: 824, y: 100 },
  );
});

test("uses the left side when there is no room on the right", () => {
  const anchor = { x: 1200, y: 600, ...widgetSize };

  assert.deepEqual(
    findAdjacentWidgetPosition(anchor, [anchor], workArea, widgetSize, 12),
    { x: 838, y: 480 },
  );
});
