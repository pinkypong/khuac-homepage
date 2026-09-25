-- Replaces the unused face_indexed column with a real, correctly-shaped one.
--
-- face_indexed (boolean not null default false) has had no reader or writer
-- anywhere in the codebase since the initial schema - grep across src/ and
-- supabase/ finds it nowhere but its own migration. Leaving it beside a new,
-- similarly-named column would be the confusing kind of duplicate this
-- project has hit before (see the ORIGIN_RANK warning in CLAUDE.md): two
-- almost-synonymous face-related booleans on one table, one of them dead.
--
-- has_face is nullable on purpose, where face_indexed was not. NULL means
-- "never checked" and is treated the same as true wherever this gates
-- anything - fail closed. A NOT NULL DEFAULT false column cannot say that:
-- every row already in this table was uploaded before any detection ever
-- ran, and those are real club photos that almost certainly contain faces.
-- Defaulting them to false ("confirmed no face") would be the one outcome
-- this column exists to prevent.
--
-- Set client-side at upload (src/lib/photos/face-detect.ts) rather than
-- trusted as a security boundary on its own - a browser could report
-- anything. Nothing in this schema change makes any photo visible to anyone
-- it was not already visible to; it only records a classification for
-- whatever public-visibility policy is decided later to read.
alter table public.photos drop column face_indexed;
alter table public.photos add column has_face boolean;

comment on column public.photos.has_face is
  'Face detected client-side at upload (src/lib/photos/face-detect.ts). NULL = never checked - treated as true (has a face) by any policy that gates on this, never as false. Not a security boundary by itself: the client-reported value is not verified server-side.';
