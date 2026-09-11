-- Removes the invite-link feature added in 20260908125418_invites.sql.
--
-- The link never did what its name suggested: /join/<token> rendered the same
-- Google/magic-link buttons as /login and still dropped the signup into the
-- approval queue, so consume_invite only wrote a note saying where someone had
-- come from. Sending the link and telling someone the domain were the same act.
--
-- Dropped rather than left in place: check_invite carried `grant execute` to
-- anon, i.e. an RPC any unauthenticated caller could reach, and consume_invite
-- is security definer over members. Dead code with a public entry point is
-- worth removing, not just unlinking from the UI.
--
-- Checked before writing this: 1 invite row (a test link) and 0 members with
-- invited_via set, so no attribution data is lost.

drop function if exists public.consume_invite(text);
drop function if exists public.check_invite(text);

alter table public.members drop column if exists invited_via;

drop table if exists public.invites;
