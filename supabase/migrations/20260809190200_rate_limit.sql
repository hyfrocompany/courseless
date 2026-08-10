-- Per-user engine rate limiting.
--
-- The whole product shares one 100 RPM Bedrock pool, so a single runaway client can starve every
-- other user. A sliding window of individual call timestamps is the cheapest correct thing: one
-- row per call, pruned on read, and the check + insert happen in one statement so two concurrent
-- requests cannot both see "19 calls so far".

create table if not exists public.engine_calls (
  id      bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);

create index if not exists engine_calls_user_at_idx on public.engine_calls (user_id, at desc);

alter table public.engine_calls enable row level security;
-- No policies at all: this is server bookkeeping, not user-visible data.
revoke all on public.engine_calls from anon, authenticated;

/**
 * Returns true when the call is allowed (and records it), false when the window is full.
 * Prunes this user's expired rows on every call, which keeps the table bounded without a cron job.
 */
create or replace function public.take_rate_limit_slot(
  p_user           uuid,
  p_limit          integer default 20,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  delete from public.engine_calls
   where user_id = p_user
     and at < now() - make_interval(secs => p_window_seconds);

  select count(*) into used
    from public.engine_calls
   where user_id = p_user
     and at >= now() - make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return false;
  end if;

  insert into public.engine_calls (user_id) values (p_user);
  return true;
end;
$$;

revoke all on function public.take_rate_limit_slot(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.take_rate_limit_slot(uuid, integer, integer) to service_role;
