-- Atomic metering. The edge function must not read-modify-write a counter: two concurrent ops from
-- the same user would both read the old value and one increment would vanish. This does it in one
-- statement and hands back the new totals so the caller can report them without a second query.

create or replace function public.increment_usage(
  p_user   uuid,
  p_period text,
  p_lessons integer default 0,
  p_coach   integer default 0,
  p_vision  integer default 0
)
returns public.usage
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.usage;
begin
  insert into public.usage (user_id, period, lessons, coach_turns, vision_calls)
  values (p_user, p_period, p_lessons, p_coach, p_vision)
  on conflict (user_id, period) do update
    set lessons      = public.usage.lessons      + excluded.lessons,
        coach_turns  = public.usage.coach_turns  + excluded.coach_turns,
        vision_calls = public.usage.vision_calls + excluded.vision_calls
  returning * into row;
  return row;
end;
$$;

-- Metering is a server concern; clients may not call this.
revoke all on function public.increment_usage(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text, integer, integer, integer)
  to service_role;
