-- When a member was last on the site.
--
-- Written by the member's own browser about once a minute while the page is
-- open, and read only on the admin's roster: members_select already admits a
-- row to its owner or to an admin, so nobody can see anybody else's. That is
-- the whole privacy design - presence tells the club when somebody was
-- browsing, which is fine for an admin checking who is active and is not
-- something to publish to everyone.
alter table public.members add column last_seen timestamptz;

comment on column public.members.last_seen is
  'Heartbeat from the member''s open tab. Admin roster only - members_select keeps it to the owner and admins.';
