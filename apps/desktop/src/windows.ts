import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const FULL_WINDOW_LABEL = "full";
const MAIN_WIDGET_WINDOW_LABEL = "main";
const WIDGET_WINDOW_LABEL = "widget";
const WIDGET_WINDOW_GAP = 12;

export const WIDGET_NAVIGATE_EVENT = "memo-widget-navigate";
export const WIDGET_WINDOW_SIZE = {
  width: 350,
  height: 420,
  minWidth: 320,
  minHeight: 360,
};

const WINDOW_OPTIONS = {
  widget: {
    title: "스미듯",
    ...WIDGET_WINDOW_SIZE,
  },
  full: {
    title: "스미듯 · 전체 메모",
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
  },
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function buildAppUrl(params: Record<string, string>) {
  const urlParams = new URLSearchParams(params);

  return `index.html?${urlParams.toString()}`;
}

function openBrowserWindow(params: Record<string, string>, openNew = false) {
  const nextUrl = new URL(window.location.href);
  const windowSize =
    params.view === "full"
      ? { width: WINDOW_OPTIONS.full.width, height: WINDOW_OPTIONS.full.height }
      : { width: WINDOW_OPTIONS.widget.width, height: WINDOW_OPTIONS.widget.height };

  nextUrl.search = new URLSearchParams(params).toString();
  let newWindowPosition = "";
  if (openNew) {
    const right = window.screenX + window.outerWidth + WIDGET_WINDOW_GAP;
    const left = window.screenX - windowSize.width - WIDGET_WINDOW_GAP;
    const x = right + windowSize.width <= window.screen.availWidth
      ? right
      : Math.max(0, left);
    newWindowPosition = `,left=${x},top=${Math.max(0, window.screenY)}`;
  }
  const openedWindow = window.open(
    nextUrl.toString(),
    openNew
      ? `memo-widget-${crypto.randomUUID()}`
      : params.view === "full"
        ? "memo-full"
        : "memo-widget",
    `width=${windowSize.width},height=${windowSize.height}${newWindowPosition}`,
  );
  openedWindow?.focus();
}

function createWindow(
  label: string,
  url: string,
  mode: "widget" | "full",
  position?: { x: number; y: number },
) {
  return new WebviewWindow(label, {
    ...WINDOW_OPTIONS[mode],
    ...position,
    url,
    decorations: false,
    transparent: false,
    shadow: true,
    resizable: true,
  });
}

async function getAdjacentWidgetPosition() {
  const source = getCurrentWindow();
  const [sourcePosition, sourceSize, monitor] = await Promise.all([
    source.outerPosition(),
    source.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return null;

  const scale = monitor.scaleFactor;
  const gap = WIDGET_WINDOW_GAP * scale;
  const widgetWidth = WIDGET_WINDOW_SIZE.width * scale;
  const widgetHeight = WIDGET_WINDOW_SIZE.height * scale;
  const { position, size } = monitor.workArea;
  const workRight = position.x + size.width;
  const workBottom = position.y + size.height;
  const right = sourcePosition.x + sourceSize.width + gap;
  const left = sourcePosition.x - widgetWidth - gap;
  const x = right + widgetWidth <= workRight
    ? right
    : left >= position.x
      ? left
      : Math.max(position.x, Math.min(right, workRight - widgetWidth));
  const y = Math.max(position.y, Math.min(sourcePosition.y, workBottom - widgetHeight));

  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

export async function openNewWidgetMemoWindow() {
  const params = { view: "widget", new: "1" };

  if (!isTauriRuntime()) {
    openBrowserWindow(params, true);
    return;
  }

  let position: { x: number; y: number } | null = null;
  try {
    position = await getAdjacentWidgetPosition();
  } catch {
    // If monitor details are unavailable, let the window use its default position.
  }

  const url = buildAppUrl({ ...params, ...(position ? { positioned: "1" } : {}) });
  createWindow(`widget-${crypto.randomUUID()}`, url, "widget", position ?? undefined);
}

export async function openFullMemoWindow(noteId?: string) {
  const url = buildAppUrl({
    view: "full",
    ...(noteId ? { noteId } : {}),
  });

  if (!isTauriRuntime()) {
    openBrowserWindow({
      view: "full",
      ...(noteId ? { noteId } : {}),
    });
    return;
  }

  const existingWindow = await WebviewWindow.getByLabel(FULL_WINDOW_LABEL);

  if (existingWindow) {
    await existingWindow.setFocus();

    if (noteId) {
      await emitTo(FULL_WINDOW_LABEL, "memo-select-note", { noteId });
    }

    return;
  }

  createWindow(FULL_WINDOW_LABEL, url, "full");
}

export async function openWidgetMemoWindow(noteId?: string) {
  const params: Record<string, string> = noteId
    ? { view: "widget", noteId }
    : { view: "widget", new: "1" };
  const url = buildAppUrl(params);

  if (!isTauriRuntime()) {
    openBrowserWindow(params);
    return;
  }

  // The configured main window is the first widget; "widget" is used after it closes.
  const existingWindow =
    (await WebviewWindow.getByLabel(MAIN_WIDGET_WINDOW_LABEL)) ??
    (await WebviewWindow.getByLabel(WIDGET_WINDOW_LABEL));

  if (existingWindow) {
    await existingWindow.setFocus();
    await emitTo(existingWindow.label, WIDGET_NAVIGATE_EVENT, {
      noteId: noteId ?? null,
    });
    return;
  }

  createWindow(WIDGET_WINDOW_LABEL, url, "widget");
}
