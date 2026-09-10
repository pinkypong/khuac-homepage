-- A location is the folder people think in ("설악산"); a hike is the specific
-- outing inside it ("대청봉, 2026-02-11"). Giving hikes their own coordinates
-- lets the map show one marker per mountain when zoomed out, and only reveal
-- the individual peaks/routes once that mountain's album is opened.
alter table public.hikes
  add column lat double precision,
  add column lng double precision;
