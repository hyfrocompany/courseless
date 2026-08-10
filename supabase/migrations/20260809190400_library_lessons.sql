-- The curated cloud library: lessons we publish, that every copy of the app can read.
--
-- This is the one table in the schema with no owner. It is not user data; it is catalogue, so the
-- read policy keys off `published` rather than auth.uid(), and signed-out apps (anon) see the same
-- shelf as signed-in ones. Writes stay service-role only — the shelf is editorial, curated through
-- scripts/publish-library-lesson.sh, never from a client.
--
-- `lesson` holds the exact object the app already knows how to import: the `lesson` half of a
-- `.courseless.json` file (src/shared/lessonFile.ts). Keeping the whole lesson as jsonb rather than
-- shredding it into columns means a new lesson field ships without a migration, and a row can be
-- handed straight to validateLessonFile() on the client. The columns beside it are shelf metadata
-- (how it is sorted and grouped here), which is deliberately NOT part of the lesson itself.

create table if not exists public.library_lessons (
  -- Slug of the title, stable across re-publishes: publishing the same lesson twice updates it.
  id           text primary key,
  title        text not null,
  tool         text,
  track        text,
  featured     boolean not null default false,
  sort         integer not null default 0,
  published    boolean not null default false,
  lesson       jsonb not null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The shelf query is always "published, featured first, then sort, then newest".
create index if not exists library_lessons_shelf_idx
  on public.library_lessons (featured desc, sort asc, published_at desc nulls last)
  where published;

create index if not exists library_lessons_track_idx
  on public.library_lessons (track)
  where published;

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_library_lessons()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists library_lessons_touch on public.library_lessons;
create trigger library_lessons_touch
  before update on public.library_lessons
  for each row execute function public.touch_library_lessons();

-- ---------------------------------------------------------------- RLS

alter table public.library_lessons enable row level security;

-- Drafts are invisible to clients: an unpublished row is a work in progress, and `published` is the
-- only switch that makes it real. Service role bypasses RLS, so the publisher still sees everything.
drop policy if exists library_lessons_select_published on public.library_lessons;
create policy library_lessons_select_published on public.library_lessons
  for select to anon, authenticated using (published);

-- No insert/update/delete policies exist: writes are service-role only, by omission.

grant usage on schema public to anon, authenticated;
grant select on public.library_lessons to anon, authenticated;
revoke insert, update, delete on public.library_lessons from anon, authenticated;
