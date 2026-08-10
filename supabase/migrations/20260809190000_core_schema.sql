-- Courseless core schema: profiles, subscriptions, usage.
--
-- Ownership model: every row belongs to exactly one auth.users row and is readable only by that
-- user. Nothing here is writable from a client — the edge functions (service role) own all writes,
-- because the same rows are the entitlement and metering record. RLS is therefore SELECT-only
-- policies plus the implicit "service role bypasses RLS" behaviour.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- subscriptions

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  price_id               text,
  status                 text not null default 'none',
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

-- The webhook arrives keyed by Stripe ids, not by our user id, so both need to be findable.
create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);
create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);

-- ---------------------------------------------------------------- usage

-- `period` is 'YYYY-MM' in UTC. One row per user per calendar month; counters only ever go up.
create table if not exists public.usage (
  user_id      uuid not null references auth.users (id) on delete cascade,
  period       text not null,
  lessons      integer not null default 0,
  coach_turns  integer not null default 0,
  vision_calls integer not null default 0,
  primary key (user_id, period)
);

-- ---------------------------------------------------------------- RLS

alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage         enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists usage_select_own on public.usage;
create policy usage_select_own on public.usage
  for select to authenticated using (auth.uid() = user_id);

-- No insert/update/delete policies exist: writes are service-role only, by omission.

-- Data API exposure: allow the owner-select above to actually reach PostgREST, but never hand out
-- write privileges to the client roles.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.subscriptions, public.usage to authenticated;
revoke insert, update, delete on public.profiles, public.subscriptions, public.usage
  from anon, authenticated;

-- ---------------------------------------------------------------- profile trigger

-- A profile row must exist the moment a user does, so the rest of the backend can assume it.
-- security definer + a pinned search_path: the function runs as owner on the auth schema's trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this migration.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;
