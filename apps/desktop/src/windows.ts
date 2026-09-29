import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const FULL_WINDOW_LABEL = "full";
const MAIN_WIDGET_WINDOW_LABEL = "main";
const WIDGET_WINDOW_LABEL = "widget";

export const WIDGET_NAVIGATE_EVENT = "memo-widget-navigate";

const WINDOW_OPTIONS = {
  widget: {
    title: "스미듯",
    width: 430,
    height: 520,
    minWidth: 320,
    minHeight: 520,
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

function openBrowserWindow(params: Record<string, string>) {
  const nextUrl = new URL(window.location.href);
  const windowSize =
    params.view === "full"
      ? { width: WINDOW_OPTIONS.full.width, height: WINDOW_OPTIONS.full.height }
      : { width: WINDOW_OPTIONS.widget.width, height: WINDOW_OPTIONS.widget.height };

  nextUrl.search = new URLSearchParams(params).toString();
  const openedWindow = window.open(
    nextUrl.toString(),
    params.view === "full" ? "memo-full" : "memo-widget",
    `width=${windowSize.width},height=${windowSize.height}`,
  );
  openedWindow?.focus();
}

function createWindow(label: string, url: string, mode: "widget" | "full") {
  return new WebviewWindow(label, {
    ...WINDOW_OPTIONS[mode],
    url,
    decorations: false,
    transparent: true,
    shadow: true,
    resizable: true,
  });
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
