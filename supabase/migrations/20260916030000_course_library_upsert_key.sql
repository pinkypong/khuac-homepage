-- Lets a course be filed again without being filed twice.
--
-- The uniqueness was on lower(mountain), lower(name) - an expression index,
-- which PostgREST cannot name in ON CONFLICT, so every upsert came back 23505
-- instead of updating. The assistant files what a search found on its way
-- back; that write was failing silently into a log nobody reads.
--
-- A plain constraint on the two columns is what upsert can target. Case is not
-- what distinguishes one Korean course name from another, and the lookup index
-- on lower(mountain) stays for reading.
drop index if exists course_library_mountain_name_key;

alter table public.course_library
  add constraint course_library_mountain_name_key unique (mountain, name);
