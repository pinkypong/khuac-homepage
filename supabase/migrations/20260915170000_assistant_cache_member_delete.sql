-- Lets a member take a question off the recent list.
--
-- Deleting was admin-only, which is the right default for a table nobody is
-- meant to prune. This one is different: the recent list is on screen, it is
-- short, and a question asked by mistake sits there for two weeks with no way
-- to remove it. The cost of a wrong deletion is that the next person to ask
-- pays for the answer again - a few cents, not a lost record.
--
-- The admin policy stays for everything else.
create policy assistant_cache_member_delete on public.assistant_cache
  for delete using (public.is_approved_member());
