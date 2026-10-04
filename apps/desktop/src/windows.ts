import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  currentMonitor,
  getCurrentWindow,
  monitorFromPoint,
} from "@tauri-apps/api/window";
import {
  findAdjacentWidgetPosition,
  findWidgetShowingNote,
  type WidgetIdentity,
  type WindowRect,
} from "./widgetPlacement";

const FULL_WINDOW_LABEL = "full";
const MAIN_WIDGET_WINDOW_LABEL = "main";
const WIDGET_WINDOW_LABEL = "widget";
const WIDGET_WINDOW_GAP = 12;

export const WIDGET_IDENTITY_REQUEST_EVENT = "memo-widget-identity-request";
export const WIDGET_IDENTITY_RESPONSE_EVENT = "memo-widget-identity-response";
export type WidgetIdentityRequest = { requestId: string; replyTo: string };
export type WidgetIdentityResponse = WidgetIdentity & { requestId: string };
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

function openBrowserWindow(
  params: Record<string, string>,
  openNew = false,
  targetName?: string,
) {
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
    targetName ?? (openNew
      ? `memo-widget-${crypto.randomUUID()}`
      : params.view === "full"
        ? "memo-full"
        : "memo-widget"),
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

async function getAdjacentWidgetPosition(
  source: WebviewWindow = getCurrentWebviewWindow(),
  occupied: WebviewWindow[] = [source],
) {
  const [sourcePosition, sourceSize] = await Promise.all([
    source.outerPosition(),
    source.outerSize(),
  ]);
  const monitor =
    (await monitorFromPoint(
      sourcePosition.x + sourceSize.width / 2,
      sourcePosition.y + sourceSize.height / 2,
    )) ?? (await currentMonitor());
  if (!monitor) return null;

  const scale = monitor.scaleFactor;
  const occupiedRects = (
    await Promise.all(
      occupied.map(async (window) => {
        try {
          const [position, size] = await Promise.all([
            window.outerPosition(),
            window.outerSize(),
          ]);
          return { x: position.x, y: position.y, width: size.width, height: size.height };
        } catch {
          return null;
        }
      }),
    )
  ).filter((rect): rect is WindowRect => rect !== null);
  const position = findAdjacentWidgetPosition(
    {
      x: sourcePosition.x,
      y: sourcePosition.y,
      width: sourceSize.width,
      height: sourceSize.height,
    },
    occupiedRects,
    {
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    },
    {
      width: WIDGET_WINDOW_SIZE.width * scale,
      height: WIDGET_WINDOW_SIZE.height * scale,
    },
    WIDGET_WINDOW_GAP * scale,
  );

  return { x: Math.round(position.x / scale), y: Math.round(position.y / scale) };
}

function isWidgetWindow(window: WebviewWindow) {
  return (
    window.label === MAIN_WIDGET_WINDOW_LABEL ||
    window.label === WIDGET_WINDOW_LABEL ||
    window.label.startsWith("widget-")
  );
}

async function getWidgetIdentities(windows: WebviewWindow[]) {
  const requestId = crypto.randomUUID();
  const identities = new Map<string, WidgetIdentity>();
  let resolveWhenComplete: (() => void) | null = null;
  const unlisten = await listen<WidgetIdentityResponse>(
    WIDGET_IDENTITY_RESPONSE_EVENT,
    ({ payload }) => {
      if (payload.requestId !== requestId) return;
      identities.set(payload.label, payload);
      if (identities.size === windows.length) resolveWhenComplete?.();
    },
  );

  try {
    await Promise.all(
      windows.map((window) =>
        emitTo(window.label, WIDGET_IDENTITY_REQUEST_EVENT, {
          requestId,
          replyTo: getCurrentWindow().label,
        } satisfies WidgetIdentityRequest).catch(() => {}),
      ),
    );
    if (identities.size < windows.length) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 250);
        resolveWhenComplete = () => {
          window.clearTimeout(timeout);
          resolve();
        };
      });
    }
  } finally {
    unlisten();
  }

  return [...identities.values()];
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
    openBrowserWindow(
      params,
      true,
      noteId ? `memo-widget-${noteId}` : undefined,
    );
    return;
  }

  const widgetWindows = (await WebviewWindow.getAll()).filter(isWidgetWindow);
  const identities = await getWidgetIdentities(widgetWindows);
  const matchingLabel = findWidgetShowingNote(identities, noteId ?? null);
  const matchingWindow = widgetWindows.find((window) => window.label === matchingLabel);

  if (matchingWindow) {
    await matchingWindow.setFocus();
    return;
  }

  const anchor = widgetWindows[0];
  let position: { x: number; y: number } | null = null;
  if (anchor) {
    try {
      position = await getAdjacentWidgetPosition(anchor, widgetWindows);
    } catch {
      // If window geometry is unavailable, let the OS place the new widget.
    }
  }

  createWindow(
    anchor ? `widget-${crypto.randomUUID()}` : WIDGET_WINDOW_LABEL,
    url,
    "widget",
    position ?? undefined,
  );
}
