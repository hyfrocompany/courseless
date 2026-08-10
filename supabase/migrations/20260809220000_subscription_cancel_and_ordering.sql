-- Two things the subscriptions row could not say, and one it could not defend itself against.
--
-- 1. A scheduled cancel. Stripe keeps `status = 'active'` right up to the period end, so a customer
--    who cancelled on the 3rd looked identical to one who did not, and the app told them their plan
--    "renews" on a date it will in fact end. `cancel_at_period_end` is the missing bit.
-- 2. Event order. Stripe delivers `customer.subscription.updated` at least once and in no
--    guaranteed order, so a retried older event could arrive after a newer one and walk the row
--    backwards (re-activating a cancelled plan, restoring a stale price). `last_event_at` records
--    the Stripe event's own `created` time and the writer below refuses anything older.
--
-- Additive: both columns are nullable, every existing row keeps working, and a row written before
-- this migration simply has no recorded event time (the first event that arrives wins).

alter table public.subscriptions add column if not exists cancel_at_period_end boolean;
alter table public.subscriptions add column if not exists last_event_at        timestamptz;

comment on column public.subscriptions.cancel_at_period_end is
  'Stripe subscription.cancel_at_period_end. True = still entitled, but it ends at current_period_end.';
comment on column public.subscriptions.last_event_at is
  'created time of the newest Stripe event applied to this row. Older events are ignored.';

-- ---------------------------------------------------------------- the one writer

-- The webhook must not read-modify-write: two Stripe deliveries for the same customer can land in
-- two concurrent function invocations, and the loser would overwrite the winner. This does the
-- ordering check and the upsert in a single statement.
--
-- Null parameter = "this event does not say", and the existing value is kept. That is what lets
-- `checkout.session.completed` fill in the ids it knows without blanking the price and period a
-- `customer.subscription.created` may already have written. `false` is a value, not a silence, so
-- un-cancelling still works.
--
-- Idempotent: replaying the same event re-applies identical values (>= rather than >), so Stripe's
-- at-least-once delivery costs nothing.
create or replace function public.apply_subscription_event(
  p_user                 uuid,
  p_event_at             timestamptz,
  p_customer             text        default null,
  p_subscription         text        default null,
  p_price                text        default null,
  p_status               text        default null,
  p_period_end           timestamptz default null,
  p_cancel_at_period_end boolean     default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.subscriptions;
begin
  insert into public.subscriptions as s (
    user_id, stripe_customer_id, stripe_subscription_id, price_id, status,
    current_period_end, cancel_at_period_end, last_event_at, updated_at
  )
  values (
    p_user, p_customer, p_subscription, p_price, coalesce(p_status, 'none'),
    p_period_end, p_cancel_at_period_end, p_event_at, now()
  )
  on conflict (user_id) do update set
    stripe_customer_id     = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
    price_id               = coalesce(excluded.price_id, s.price_id),
    -- excluded.status carries the 'none' fallback from the insert list, so read the argument.
    status                 = coalesce(p_status, s.status),
    current_period_end     = coalesce(excluded.current_period_end, s.current_period_end),
    cancel_at_period_end   = coalesce(excluded.cancel_at_period_end, s.cancel_at_period_end),
    -- greatest() skips nulls, so a row that predates this migration adopts the first event time.
    last_event_at          = greatest(excluded.last_event_at, s.last_event_at),
    updated_at             = now()
  where p_event_at is null
     or s.last_event_at is null
     or p_event_at >= s.last_event_at
  returning * into row;

  -- The where clause above suppressed the update: this event is older than what the row already
  -- has. Hand back the row as it stands so the caller sees the winning state, not an error.
  if row is null then
    select * into row from public.subscriptions where user_id = p_user;
  end if;
  return row;
end;
$$;

revoke all on function public.apply_subscription_event(
  uuid, timestamptz, text, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(
  uuid, timestamptz, text, text, text, text, timestamptz, boolean
) to service_role;
