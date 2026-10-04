export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WidgetIdentity = {
  label: string;
  noteId: string | null;
};

export function findWidgetShowingNote(
  widgets: WidgetIdentity[],
  noteId: string | null,
) {
  return widgets.find((widget) => widget.noteId === noteId)?.label ?? null;
}

function overlaps(first: WindowRect, second: WindowRect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export function findAdjacentWidgetPosition(
  anchor: WindowRect,
  occupied: WindowRect[],
  workArea: WindowRect,
  widgetSize: { width: number; height: number },
  gap: number,
) {
  const workRight = workArea.x + workArea.width;
  const y = Math.max(
    workArea.y,
    Math.min(anchor.y, workArea.y + workArea.height - widgetSize.height),
  );

  let x = anchor.x + anchor.width + gap;
  while (x + widgetSize.width <= workRight) {
    const candidate = { x, y, ...widgetSize };
    const collisions = occupied.filter((window) => overlaps(candidate, window));
    if (collisions.length === 0) return { x, y };
    x = Math.max(...collisions.map((window) => window.x + window.width)) + gap;
  }

  x = anchor.x - widgetSize.width - gap;
  while (x >= workArea.x) {
    const candidate = { x, y, ...widgetSize };
    const collisions = occupied.filter((window) => overlaps(candidate, window));
    if (collisions.length === 0) return { x, y };
    x = Math.min(...collisions.map((window) => window.x)) - widgetSize.width - gap;
  }

  return {
    x: Math.max(workArea.x, Math.min(anchor.x, workRight - widgetSize.width)),
    y,
  };
}
