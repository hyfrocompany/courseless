#!/usr/bin/env bash
#
# Provision the Courseless Stripe objects. Idempotent: re-running it finds what already exists and
# only creates what is missing, so the same script is the live-mode replay.
#
#   scripts/provision-stripe.sh              # test mode (default)
#   LIVE=1 scripts/provision-stripe.sh       # live mode — creates real, chargeable objects
#   RECREATE_WEBHOOK=1 scripts/provision-stripe.sh
#
# Stripe reveals a webhook endpoint's signing secret ONLY in the create response. If the endpoint
# already exists the script says so and leaves your existing STRIPE_WEBHOOK_SECRET alone; pass
# RECREATE_WEBHOOK=1 to delete and recreate it when you need a fresh secret.
#
# Requires: stripe CLI (logged in), jq.
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-xxeagfxivrjpvofwvvmh}"
WEBHOOK_URL="${WEBHOOK_URL:-https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook}"

# Test mode is the CLI default, so it needs no flag; live mode is opt-in and loud.
MODE_ARGS=()
if [ "${LIVE:-0}" = "1" ]; then
  MODE_ARGS=(--live)
  MODE="LIVE"
else
  MODE="TEST"
fi

# The ${x[@]+...} guard keeps an empty array from tripping `set -u` on macOS's bash 3.2.
# --live must come AFTER the subcommand (stripe CLI 1.45 rejects it as a leading arg).
sc() { stripe "$@" ${MODE_ARGS[@]+"${MODE_ARGS[@]}"}; }

# Stripe Managed Payments requires a product tax code before a checkout session will build.
# "SaaS - electronic download - personal use" is the closest fit: a downloaded desktop app whose
# coaching runs in our cloud, sold to individuals.
TAX_CODE="${TAX_CODE:-txcd_10103100}"

echo "==> Stripe provisioning in $MODE mode"
echo "    webhook target: $WEBHOOK_URL"

# ---------------------------------------------------------------- products

# Products have no natural unique key, so we match on name and reuse the first hit.
find_product() {
  sc products list --limit 100 2>/dev/null \
    | jq -r --arg n "$1" '[.data[] | select(.name == $n and .active == true)][0].id // empty'
}

ensure_product() {
  local name="$1" desc="$2" id existing_tax
  id="$(find_product "$name")"
  if [ -n "$id" ]; then
    echo "    product exists: $name ($id)" >&2
    # Managed Payments (on by default) refuses a checkout whose product has no tax code, so an
    # older product created without one gets repaired rather than silently breaking checkout.
    existing_tax="$(sc products retrieve "$id" | jq -r '.tax_code // empty')"
    if [ -z "$existing_tax" ]; then
      sc products update "$id" -d "tax_code=$TAX_CODE" >/dev/null
      echo "    product tax_code set: $name -> $TAX_CODE" >&2
    fi
  else
    id="$(sc products create \
          -d "name=$name" \
          -d "description=$desc" \
          -d "tax_code=$TAX_CODE" | jq -r '.id')"
    echo "    product created: $name ($id)" >&2
  fi
  printf '%s' "$id"
}

# ---------------------------------------------------------------- prices

# lookup_key IS the unique key, and it is what the billing function resolves at checkout time.
ensure_price() {
  local product="$1" lookup="$2" amount="$3" interval="$4" id
  id="$(sc prices list --limit 100 -d "lookup_keys[0]=$lookup" 2>/dev/null \
        | jq -r '[.data[] | select(.active == true)][0].id // empty')"
  if [ -n "$id" ]; then
    echo "    price exists: $lookup ($id)" >&2
  else
    id="$(sc prices create \
          -d "product=$product" \
          -d "unit_amount=$amount" \
          -d "currency=usd" \
          -d "recurring[interval]=$interval" \
          -d "lookup_key=$lookup" \
          -d "nickname=$lookup" | jq -r '.id')"
    echo "    price created: $lookup ($id)" >&2
  fi
  printf '%s' "$id"
}

echo "==> Products"
PRO_ID="$(ensure_product 'Courseless Pro' 'Courseless Pro — 150 lessons, 2000 coach messages and 1000 screen lookups a month.')"
MAX_ID="$(ensure_product 'Courseless Max' 'Courseless Max — unlimited lessons, coaching and screen lookups (fair use applies).')"

echo "==> Prices"
PRO_MONTHLY="$(ensure_price "$PRO_ID" pro_monthly 2000  month)"
PRO_ANNUAL="$( ensure_price "$PRO_ID" pro_annual  19200 year)"
MAX_MONTHLY="$(ensure_price "$MAX_ID" max_monthly 5000  month)"
MAX_ANNUAL="$( ensure_price "$MAX_ID" max_annual  48000 year)"

# ---------------------------------------------------------------- customer portal configuration

# All billing management — cancel, switch plan, card, invoices — happens in the hosted portal, so
# the configuration is part of the product, not a dashboard afterthought. A brand-new account has no
# portal configuration at all and `billing_portal/sessions` fails outright until one exists.
echo "==> Customer portal configuration"

PORTAL_ARGS=(
  -d "business_profile[headline]=Courseless"
  -d "metadata[courseless_managed]=v1"
  -d "features[invoice_history][enabled]=true"
  -d "features[payment_method_update][enabled]=true"
  -d "features[customer_update][enabled]=true"
  -d "features[customer_update][allowed_updates][0]=email"
  -d "features[customer_update][allowed_updates][1]=address"
  -d "features[subscription_cancel][enabled]=true"
  -d "features[subscription_cancel][mode]=at_period_end"
  -d "features[subscription_update][enabled]=true"
  -d "features[subscription_update][default_allowed_updates][0]=price"
  -d "features[subscription_update][proration_behavior]=create_prorations"
  -d "features[subscription_update][products][0][product]=$PRO_ID"
  -d "features[subscription_update][products][0][prices][0]=$PRO_MONTHLY"
  -d "features[subscription_update][products][0][prices][1]=$PRO_ANNUAL"
  # Courseless is one seat per account; a quantity stepper in the portal would only confuse.
  -d "features[subscription_update][products][0][adjustable_quantity][enabled]=false"
  -d "features[subscription_update][products][1][product]=$MAX_ID"
  -d "features[subscription_update][products][1][prices][0]=$MAX_MONTHLY"
  -d "features[subscription_update][products][1][prices][1]=$MAX_ANNUAL"
  -d "features[subscription_update][products][1][adjustable_quantity][enabled]=false"
)
[ -n "${SITE_URL:-}" ] && PORTAL_ARGS+=(-d "default_return_url=${SITE_URL%/}/account")

PORTAL_ID="$(sc billing_portal configurations list --limit 100 2>/dev/null \
  | jq -r '[.data[] | select(.metadata.courseless_managed == "v1" and .active == true)][0].id // empty')"

if [ -n "$PORTAL_ID" ]; then
  sc billing_portal configurations update "$PORTAL_ID" "${PORTAL_ARGS[@]}" >/dev/null
  echo "    configuration updated: $PORTAL_ID"
else
  PORTAL_ID="$(sc billing_portal configurations create "${PORTAL_ARGS[@]}" | jq -r '.id')"
  echo "    configuration created: $PORTAL_ID"
fi

# ---------------------------------------------------------------- webhook endpoint

EVENTS=(
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
)

echo "==> Webhook endpoint"
EXISTING="$(sc webhook_endpoints list --limit 100 2>/dev/null \
  | jq -r --arg u "$WEBHOOK_URL" '[.data[] | select(.url == $u)][0].id // empty')"

if [ -n "$EXISTING" ] && [ "${RECREATE_WEBHOOK:-0}" = "1" ]; then
  echo "    deleting existing endpoint $EXISTING (RECREATE_WEBHOOK=1)"
  # --confirm: the CLI otherwise blocks on an interactive y/N prompt.
  sc webhook_endpoints delete --confirm "$EXISTING" >/dev/null
  EXISTING=""
fi

if [ -n "$EXISTING" ]; then
  echo "    endpoint exists: $EXISTING"
  echo "    signing secret is not retrievable after creation — keeping the current STRIPE_WEBHOOK_SECRET."
  WEBHOOK_SECRET=""
else
  ARGS=(-d "url=$WEBHOOK_URL" -d "description=Courseless subscription sync")
  for i in "${!EVENTS[@]}"; do ARGS+=(-d "enabled_events[$i]=${EVENTS[$i]}"); done
  CREATED="$(sc webhook_endpoints create "${ARGS[@]}")"
  WEBHOOK_SECRET="$(printf '%s' "$CREATED" | jq -r '.secret // empty')"
  echo "    endpoint created: $(printf '%s' "$CREATED" | jq -r '.id')"
fi

# ---------------------------------------------------------------- output

# The engine maps a subscription's price id to a plan tier through this env var.
PRICE_PLAN_MAP="${PRO_MONTHLY}:pro,${PRO_ANNUAL}:pro,${MAX_MONTHLY}:max,${MAX_ANNUAL}:max"

OUT="${OUT:-.stripe-provision.$(echo "$MODE" | tr '[:upper:]' '[:lower:]').env}"

# A re-run that did not recreate the endpoint has no secret to write. Carry the previous one across
# rather than truncating the file and losing the only copy.
if [ -z "$WEBHOOK_SECRET" ] && [ -f "$OUT" ]; then
  WEBHOOK_SECRET="$(sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' "$OUT" | head -1)"
fi

{
  echo "# Generated by scripts/provision-stripe.sh ($MODE mode) — gitignored, do not commit."
  echo "STRIPE_PRICE_PRO_MONTHLY=$PRO_MONTHLY"
  echo "STRIPE_PRICE_PRO_ANNUAL=$PRO_ANNUAL"
  echo "STRIPE_PRICE_MAX_MONTHLY=$MAX_MONTHLY"
  echo "STRIPE_PRICE_MAX_ANNUAL=$MAX_ANNUAL"
  echo "STRIPE_PRICE_PLAN_MAP=$PRICE_PLAN_MAP"
  echo "STRIPE_PORTAL_CONFIGURATION_ID=$PORTAL_ID"
  [ -n "$WEBHOOK_SECRET" ] && echo "STRIPE_WEBHOOK_SECRET=$WEBHOOK_SECRET"
} > "$OUT"

echo
echo "==> Wrote $OUT"
echo "    Next: supabase secrets set --env-file $OUT --project-ref $PROJECT_REF"
echo "    (STRIPE_SECRET_KEY must be set separately — it is never written by this script.)"
