-- 멀티피치/하드프리 used to be locations.type - a crag was its own place
-- (인수봉, 삼성산 숨은암장). That location was merged into its mountain
-- (인수봉 -> 북한산) because course_library already groups by mountain, and a
-- second, independent place for the same feature just gave a member two
-- names to pick between for one climb.
--
-- The distinction itself was real and still needs somewhere to live: a member
-- filing a climb still knows whether it was a wall of pitches or a short hard
-- line, and the club still wants to browse one apart from the other. That is
-- now a tag on the climb itself, not on where it happened - one mountain can
-- hold both kinds, the way 북한산 already does after the merge.
create type public.climbing_style as enum (
  'multi_pitch',
  'hard_free'
);

comment on type public.climbing_style is
  'A tag on a climbing hike, not a location - see this migration''s header.';

-- Null for every non-climbing hike, and left null on a climb whose member did
-- not say - it is a refinement, not a requirement blocking the album.
alter table public.hikes
  add column climbing_style public.climbing_style;

alter table public.hikes
  add constraint hikes_climbing_style_only_for_climbing
  check (climbing_style is null or activity_type = 'climbing');
