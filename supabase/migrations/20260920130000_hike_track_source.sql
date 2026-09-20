-- Where an album's drawn line came from.
--
-- Nothing recorded this. page.tsx reported "gpx" for any track at all, so a
-- line this app drew by snapping waypoints to trails was indistinguishable
-- from a walk a member actually recorded. That is why editing a course cannot
-- redraw the line on its own: it could not tell which kind it was about to
-- replace, and replacing a GPX destroys the only copy of it.
--
--   gpx         a member uploaded a recording of a walk they did
--   trail_pick  a member tapped the segments on the map, one by one
--   course      this app snapped the album's waypoints to mapped trails
--   null        written before this column existed, so unknown - treated as
--               precious, the same as gpx, and only replaced when asked
alter table public.hikes
  add column track_source text
  check (track_source in ('gpx', 'trail_pick', 'course'));

comment on column public.hikes.track_source is
  'Origin of hikes.track: gpx | trail_pick | course. Null means it predates this column and is not overwritten without asking.';
