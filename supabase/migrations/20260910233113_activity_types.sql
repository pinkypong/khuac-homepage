-- The place is the folder (관악산); the activity is what was done there.
-- One mountain can host both a hike and a climb, so the kind of outing
-- belongs on the activity rather than only on the location.
create type public.activity_type as enum (
  'hiking',           -- 산
  'indoor_climbing',  -- 실내암장
  'outdoor_wall',     -- 외벽
  'climbing'          -- 등반
);

alter table public.hikes
  add column activity_type public.activity_type not null default 'hiking';
