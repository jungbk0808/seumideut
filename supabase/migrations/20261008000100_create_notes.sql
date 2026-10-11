begin;

create table public.notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Local .md notes can have legacy string IDs; importing must preserve them.
  id text not null check (length(btrim(id)) > 0),
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_pinned boolean not null default false,
  schema_version integer not null default 1 check (schema_version > 0),
  primary key (user_id, id)
);

create index notes_user_updated_idx on public.notes (user_id, updated_at desc, id);

alter table public.notes enable row level security;

-- Explicit grants also work with "Automatically expose new tables" disabled.
revoke all on table public.notes from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert on table public.notes to authenticated;
-- Ownership, ID and creation time are immutable after insertion.
grant update (title, content, updated_at, deleted_at, is_pinned, schema_version)
  on public.notes to authenticated;

create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy notes_insert_own on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy notes_update_own on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No DELETE grant/policy: deletion is an UPDATE of deleted_at, so future sync
-- can read tombstones and propagate deletions between devices.
comment on table public.notes is 'Owner-scoped Markdown notes; deletion uses deleted_at.';

commit;
