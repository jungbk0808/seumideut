# Memo App MVP Project Guide

## Purpose

Build a lightweight local-first desktop memo app MVP that the owner can personally use within 1-2 weeks.

The product identity is not a full-featured all-in-one notes app. It is a small desktop-first memo tool that can stay near the user's working surface, support fast writing, and show live character counts.

## Start Here

Before implementation or product decisions, read these files in order:

1. `idea2planning/outputs/prd_로컬우선메모앱_260825.md`
2. `idea2planning/outputs/wireframe_로컬우선메모앱_260825.md`
3. `idea2planning/outputs/dev_backlog_로컬우선메모앱_260825.md`
4. `idea2planning/outputs/1pager_로컬우선메모앱_260821.md`

Use the PRD as the behavioral source of truth, the wireframe as the UI structure source of truth, and the backlog as the implementation sequence.

## Design Reference

Use this Figma file when implementing or reviewing UI:

- Figma: https://www.figma.com/design/Qdw5rvoIKeMyKIhGGLCqky
- Primary page: `Editable v2`
- Main frames:
  - `Screen / Widget Quick Memo - Editable`
  - `Screen / Full Memo Management - Editable`
  - `State / Empty - Editable`
  - `State / Delete Confirmation - Editable`
- Main components:
  - `Memo v2/Button/Text`
  - `Memo v2/Button/Danger`
  - `Memo v2/Icon Button/Pin`
  - `Memo v2/Icon Button/Plus`
  - `Memo v2/Icon Button/Close`
  - `Memo v2/List Item`

The `Memo v2/Icon Button/Pin` component is a variant set with `Pinned=false` and `Pinned=true`.

- `Pinned=false`: outlined diagonal/unpinned pin.
- `Pinned=true`: filled upright/pinned pin.

The widget header uses the shared `Header` component and its actions are ordered as Pin, Plus, Close. The close action is for dismissing the memo-style widget window, not deleting a memo.

## Product Direction

The MVP should prioritize:

- Widget-style quick memo as the default entry screen
- Desktop-first accessibility, especially always-on-top behavior
- Title and body editing
- Local storage
- Autosave
- Live character counter
- Full memo management screen for search/list/edit
- Simple, calm UI with low friction

The widget is the main experience. The full memo screen is secondary and should appear when the user chooses `전체 메모 열기`.

## Core UX Decisions

- The app opens into a small widget-style quick memo.
- The widget does not show recent memo chips or a memo list.
- The widget focuses on the current memo only.
- The full memo screen uses a 2-pane layout:
  - Left: search and recent memo list
  - Right: selected memo editor
- Character count appears in the lower-right area in a subtle style.
- Show both counts: `공백 포함 N자 · 제외 N자`.
- Deletion must use a confirmation modal.
- Empty, saving, saved, and save-failed states should be visible.

## MVP Scope

Include:

- Widget-style quick memo window
- New memo
- Edit title/body
- Local persistence
- Autosave with debounce
- Character count with and without whitespace
- Full memo management screen
- Search by title/body
- Delete confirmation
- Always-on-top toggle
- Basic empty/error states

Exclude:

- Login/accounts
- Cloud sync
- Web app
- Mobile app
- Team/workspace features
- Real-time collaboration
- Payments/subscriptions
- AI summary/classification
- Plugin marketplace
- Complex permission management
- Block-editor style rich document editing

## Data Model

Use this conceptual shape unless implementation constraints require a small adjustment:

```ts
type Note = {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  isPinned: boolean
  schemaVersion: number
}
```

Keep `id`, `updatedAt`, and `schemaVersion` from the beginning so future sync/migration work has a stable base.

## Character Count Rules

- Count against the note body, not the title.
- Whitespace-included count includes spaces, tabs, and line breaks.
- Whitespace-excluded count excludes spaces, tabs, and line breaks.
- Empty content displays `공백 포함 0자 · 제외 0자`.
- Update counts live while typing.

## Recommended Implementation Order

1. Initialize desktop app project.
2. Render widget-style quick memo as the default view.
3. Implement title/body input state.
4. Implement character counter.
5. Implement local storage.
6. Add autosave with debounce.
7. Restore notes after app restart.
8. Add new memo and delete confirmation.
9. Build full memo management screen.
10. Add memo list, selection, and search.
11. Add always-on-top behavior.
12. Run save/restore and character-count tests.

## Quality Bar

The first usable version should feel fast and stable, even if it is small.

Acceptance criteria:

- App launches into the widget view.
- User can type a memo immediately.
- Memo survives app restart.
- Autosave status is understandable.
- Character counts are accurate for Korean, English, numbers, spaces, tabs, and line breaks.
- `전체 메모 열기` shows list/search/edit in the 2-pane management screen.
- Delete requires confirmation.
- MVP can be used by the owner for 7 consecutive days.

## Tone For Future Planning

When making tradeoffs, prefer:

- Small before broad
- Desktop-first before cross-platform
- Writing flow before organization features
- Local reliability before sync
- Clear MVP boundaries before feature expansion

Do not expand scope unless the user explicitly asks for it.
