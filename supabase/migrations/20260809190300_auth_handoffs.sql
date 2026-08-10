-- Web-based login handoff.
--
-- The desktop app cannot host a login form without owning the password, so it opens the website
-- with ?pair=<id>, the site signs the user in, and the resulting refresh token is left here for the
-- app to collect exactly once. Two secrets guard it: the row id (in the URL, so it leaks to the
-- browser) and a secret the app never sends anywhere except at redeem time. Only the SHA-256 of
-- that secret is stored, so a dump of this table cannot redeem anything.

create table if not exists public.auth_handoffs (
  id            uuid primary key,
  secret_hash   text not null,
  refresh_token text,
  user_id       uuid references auth.users (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'complete', 'redeemed')),
  created_at    timestamptz not null default now()
);

create index if not exists auth_handoffs_created_at_idx on public.auth_handoffs (created_at);

alter table public.auth_handoffs enable row level security;
-- No policies: this table holds live refresh tokens and is service-role only, by omission.
revoke all on public.auth_handoffs from anon, authenticated;
