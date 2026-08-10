#!/usr/bin/env bash
# Run SQL against the linked Supabase project through the Management API.
#
# `supabase db push` needs the database password, which we do not hold; the Management API accepts
# the CLI's own access token (macOS keychain, service "Supabase CLI") and runs arbitrary SQL. Same
# privileges, no password prompt, so migrations stay scriptable.
#
#   scripts/supabase-sql.sh supabase/migrations/0001_x.sql     # run a file
#   echo 'select 1;' | scripts/supabase-sql.sh                 # run stdin
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-xxeagfxivrjpvofwvvmh}"
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s 'Supabase CLI' -w)}"

if [ $# -ge 1 ]; then SQL="$(cat "$1")"; else SQL="$(cat)"; fi

BODY="$(SQL="$SQL" python3 -c 'import json,os;print(json.dumps({"query":os.environ["SQL"]}))')"

curl -sS -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY"
echo
