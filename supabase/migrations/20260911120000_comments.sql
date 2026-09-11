-- Phase 5: 댓글 — a comment hangs off exactly one subject, either a single
-- photo or a whole activity. Two nullable FKs plus a check constraint keep
-- that in one table: the two kinds read and write identically, and a single
-- set of RLS policies covers both.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  -- Nullable so a departed member's comments stay readable, matching how
  -- locations.created_by / hikes.created_by survive their author.
  author_id uuid references public.members (id) on delete set null,
  -- Cascade, unlike photos.hike_id and hikes.location_id which are SET NULL:
  -- those rows still mean something once detached, but a comment about a
  -- deleted photo has nothing left to say, so it goes with its subject.
  photo_id uuid references public.photos (id) on delete cascade,
  hike_id uuid references public.hikes (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one subject: neither an orphan nor a comment on two things.
  constraint comments_one_subject check ((photo_id is null) <> (hike_id is null)),
  -- Whitespace-only bodies are rejected here too, not just in the server
  -- action, so the constraint holds even if a caller reaches PostgREST direct.
  constraint comments_body_length check (
    char_length(btrim(body)) between 1 and 1000
  )
);

-- Both feeds load by subject: the lightbox by photo, the detail panel by hike.
create index comments_photo_id_idx on public.comments (photo_id);
create index comments_hike_id_idx on public.comments (hike_id);

create trigger set_updated_at before update on public.comments
  for each row execute function public.set_updated_at();

alter table public.comments enable row level security;

-- Readable by any approved member, matching photos_select / hikes_select.
create policy comments_select on public.comments
  for select using (public.is_approved_member());

-- No writing in someone else's name: author_id must be the caller's own
-- member row, admins included.
create policy comments_insert on public.comments
  for insert with check (
    public.is_approved_member()
    and author_id = public.current_member_id()
  );

-- Editing is the author's alone - an admin rewording a member's words would
-- put sentences in their mouth. Admins get the delete instead.
create policy comments_update on public.comments
  for update
  using (author_id = public.current_member_id())
  with check (author_id = public.current_member_id());

create policy comments_delete on public.comments
  for delete using (author_id = public.current_member_id() or public.is_admin());
