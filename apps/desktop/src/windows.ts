import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const FULL_WINDOW_LABEL = "full";

const WINDOW_OPTIONS = {
  widget: {
    title: "Memo",
    width: 430,
    height: 520,
    minWidth: 320,
    minHeight: 520,
  },
  full: {
    title: "전체 메모",
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
  window.open(
    nextUrl.toString(),
    "_blank",
    `width=${windowSize.width},height=${windowSize.height}`,
  );
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
  const label = `widget-${crypto.randomUUID()}`;
  const params: Record<string, string> = noteId
    ? { view: "widget", noteId }
    : { view: "widget", new: "1" };
  const url = buildAppUrl(params);

  if (!isTauriRuntime()) {
    openBrowserWindow(params);
    return;
  }

  createWindow(label, url, "widget");
}
