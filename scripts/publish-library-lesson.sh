#!/usr/bin/env bash
# Publish a lesson to the curated cloud library (public.library_lessons).
#
# The shelf is editorial: rows only ever arrive through this script, never from a client, because
# the table is service-role-write by RLS. What lands in the `lesson` column is the SAME object the
# app exports and imports — the `lesson` half of a `.courseless.json` file — rebuilt here from an
# allow-list that mirrors buildLessonFile() in src/shared/lessonFile.ts. Nothing local to whoever
# authored it (thread ids, run history, builtin/featured/track flags) can ride along, even if the
# input file has those keys.
#
# Writes go through the Management API (scripts/supabase-sql.sh) because we hold the CLI access
# token but not the database password. There are no bind parameters on that endpoint, so every
# value is emitted as a dollar-quoted literal with a tag proven absent from the payload.
#
#   scripts/publish-library-lesson.sh lesson.courseless.json
#   scripts/publish-library-lesson.sh lesson.json --track "Excel" --feature --sort 10
#   scripts/publish-library-lesson.sh --unpublish a-budget-model-that-holds-up
#   scripts/publish-library-lesson.sh --list
#
# The id is slugify(title), so re-publishing an edited lesson updates the same row rather than
# growing a second one. Publishing sets published = true and stamps published_at.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SQL="$HERE/supabase-sql.sh"

usage() {
  cat >&2 <<'USAGE'
usage: publish-library-lesson.sh <path.courseless.json|path-to-lesson.json> [--feature] [--track X] [--sort N]
       publish-library-lesson.sh --unpublish <id>
       publish-library-lesson.sh --list
USAGE
  exit 2
}

FILE=""
TRACK=""
FEATURE=0
SORT=""
MODE="publish"
UNPUBLISH_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list)      MODE="list"; shift ;;
    --unpublish) MODE="unpublish"; UNPUBLISH_ID="${2:-}"; [ -n "$UNPUBLISH_ID" ] || usage; shift 2 ;;
    --feature)   FEATURE=1; shift ;;
    --track)     TRACK="${2:-}"; [ -n "$TRACK" ] || usage; shift 2 ;;
    --sort)      SORT="${2:-}"; [ -n "$SORT" ] || usage; shift 2 ;;
    -h|--help)   usage ;;
    -*)          echo "unknown option: $1" >&2; usage ;;
    *)           [ -z "$FILE" ] || usage; FILE="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------- helpers

# Emit a dollar-quoted SQL literal for stdin, using a tag that does not occur in the text.
sql_literal() {
  python3 -c '
import secrets, sys
s = sys.stdin.read()
while True:
    tag = "$q%s$" % secrets.token_hex(6)
    if tag not in s:
        break
sys.stdout.write(tag + s + tag)
'
}

# ---------------------------------------------------------------- --list

if [ "$MODE" = "list" ]; then
  OUT="$(printf '%s' "
select id, title, published, featured, sort, track
  from public.library_lessons
 order by featured desc, sort asc, published_at desc nulls last, id;
" | "$RUN_SQL")"
  OUT="$OUT" python3 <<'PY'
import json, os, sys

raw = os.environ["OUT"]
try:
    rows = json.loads(raw)
except Exception:
    print(raw, file=sys.stderr); sys.exit(1)
if isinstance(rows, dict):
    print("supabase error:", rows.get("message", rows), file=sys.stderr); sys.exit(1)
if not rows:
    print("(no rows in public.library_lessons)"); sys.exit(0)

w = max(max(len(r["id"]) for r in rows), 2)
print(f'{"id".ljust(w)}  pub  feat  {"track".ljust(14)}  title')
print("-" * (w + 2 + 3 + 2 + 4 + 2 + 14 + 2 + 40))
for r in rows:
    pub = "yes" if r["published"] else " no"
    feat = "yes " if r["featured"] else "  - "
    track = (r.get("track") or "-")[:14].ljust(14)
    print(f'{r["id"].ljust(w)}  {pub}  {feat}  {track}  {r["title"]}')
PY
  exit 0
fi

# ---------------------------------------------------------------- --unpublish

if [ "$MODE" = "unpublish" ]; then
  ID_LIT="$(printf '%s' "$UNPUBLISH_ID" | sql_literal)"
  RES="$(printf '%s' "
update public.library_lessons set published = false where id = $ID_LIT returning id, title, published;
" | "$RUN_SQL")"
  RES="$RES" python3 <<'PY'
import json, os, sys

raw = os.environ["RES"]
try:
    rows = json.loads(raw)
except Exception:
    print(raw, file=sys.stderr); sys.exit(1)
if isinstance(rows, dict):
    print("supabase error:", rows.get("message", rows), file=sys.stderr); sys.exit(1)
if not rows:
    print("no such id in public.library_lessons", file=sys.stderr); sys.exit(1)
print(f'unpublished {rows[0]["id"]}  ({rows[0]["title"]})')
PY
  exit 0
fi

# ---------------------------------------------------------------- publish

[ -n "$FILE" ] || usage
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

# Validate + normalise in one pass: writes the row as JSON, or explains the rejection and exits.
# (Via a temp file, not $(...): bash 3.2 miscounts apostrophes in a heredoc nested in a command
# substitution, and this program is full of prose.)
ROW_TMP="$(mktemp -t courseless-library-row)"
trap 'rm -f "$ROW_TMP"' EXIT

FILE="$FILE" TRACK="$TRACK" FEATURE="$FEATURE" SORT="$SORT" python3 > "$ROW_TMP" <<'PY'
import json, os, re, sys, unicodedata

def die(msg):
    print(f"rejected: {msg}", file=sys.stderr)
    sys.exit(1)

def typename(v):
    if v is None: return "null"
    if isinstance(v, list): return "an array"
    return "a " + type(v).__name__

path = os.environ["FILE"]
try:
    raw = json.loads(open(path, encoding="utf-8").read())
except json.JSONDecodeError as e:
    die(f"{path} is not valid JSON: {e}")

if not isinstance(raw, dict):
    die(f"the file's top level is {typename(raw)}, not an object")

# Accept both halves of the boundary: a whole .courseless.json file, or a bare lesson object.
if "lesson" in raw or "format" in raw:
    if raw.get("format") != "courseless-lesson":
        die(f'"format" is {json.dumps(raw.get("format"))}, expected "courseless-lesson"')
    fv = raw.get("formatVersion")
    if not isinstance(fv, (int, float)):
        die('"formatVersion" is missing or is not a number')
    if fv > 1:
        die(f'"formatVersion" is {fv}; this publisher writes version 1')
    l = raw.get("lesson")
    if not isinstance(l, dict):
        die(f'"lesson" is {typename(l)}, not an object')
else:
    l = raw

# --- required fields (stricter than the importer: the importer repairs, a publisher rejects) ---

title = l.get("title")
if not isinstance(title, str) or not title.strip():
    die('"lesson.title" is missing — every lesson needs a title')
title = title.strip()

steps_in = l.get("steps")
if steps_in is None:
    die('"lesson.steps" is missing — a lesson is its steps')
if not isinstance(steps_in, list):
    die(f'"lesson.steps" is {typename(steps_in)}, not an array')
if not steps_in:
    die('"lesson.steps" is empty — there is nothing to run')

steps = []
for i, s in enumerate(steps_in):
    at = f'"lesson.steps[{i}]'
    if not isinstance(s, dict):
        die(f"{at}\" is {typename(s)}, not an object")
    action = s.get("action")
    if not isinstance(action, str) or not action.strip():
        die(f'{at}.action" is missing — a step has to say what to do')
    checkpoint = s.get("checkpoint")
    if not isinstance(checkpoint, str) or not checkpoint.strip():
        die(f'{at}.checkpoint" is missing — a published step must say how the learner knows it worked')
    hints = s.get("hint_levels")
    if not isinstance(hints, list):
        die(f'{at}.hint_levels" is {typename(hints)}, not an array of 3 strings')
    if len(hints) != 3:
        die(f'{at}.hint_levels" has {len(hints)} entries, expected exactly 3 (nudge, narrower, answer)')
    if not all(isinstance(h, str) and h.strip() for h in hints):
        die(f'{at}.hint_levels" contains an empty or non-string hint')
    tier = s.get("fade_tier")
    tier = tier if tier in (1, 2, 3) else 2
    target = s.get("target")
    target = target.strip() if isinstance(target, str) else ""
    step = {
        "action": action.strip(),
        "where": s["where"] if isinstance(s.get("where"), str) else "",
        "why": s["why"] if isinstance(s.get("why"), str) else "",
        "checkpoint": checkpoint.strip(),
        "hint_levels": [h.strip() for h in hints],
        "fade_tier": tier,
    }
    if target:
        step["target"] = target
    steps.append(step)

# --- id: slugify(title), byte-for-byte the same rule as src/shared/lessonFile.ts ---

def slugify(t):
    s = unicodedata.normalize("NFKD", (t or "").lower())
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)[:60]
    s = re.sub(r"-+$", "", s)
    return s or "lesson"

lesson_id = slugify(title)

def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None

est = num(l.get("est_minutes"))
seed = num(l.get("coverSeed"))
version = num(l.get("version"))

# The allow-list. A field not named here does not reach the cloud, however the input file spells it:
# builtin / featured / track / importedFrom describe a shelf, not a lesson, and codexThreadId + runs
# are the author's own machine. Mirrors buildLessonFile().
lesson = {
    "id": lesson_id,
    "title": title,
    "tool": l["tool"] if isinstance(l.get("tool"), str) else "",
    "goal": l["goal"] if isinstance(l.get("goal"), str) else "",
    "est_minutes": round(est) if est and est > 0 else max(3, len(steps) * 3),
    "prerequisites": [p for p in l.get("prerequisites", []) if isinstance(p, str) and p.strip()][:6]
    if isinstance(l.get("prerequisites"), list) else [],
    "steps": steps,
    "coverSeed": abs(round(seed)) if seed is not None else 0,
    "codexThreadId": None,
    "createdAt": l["createdAt"] if isinstance(l.get("createdAt"), str) else "",
    "runs": [],
    "version": round(version) if version and version > 0 else 1,
}
if isinstance(l.get("audience"), str) and l["audience"]:
    lesson["audience"] = l["audience"]
if l.get("recordedByYou") is True:
    lesson["recordedByYou"] = True

print(json.dumps({
    "id": lesson_id,
    "title": title,
    "tool": lesson["tool"] or None,
    "track": os.environ["TRACK"] or None,
    "featured": os.environ["FEATURE"] == "1",
    "sort": int(os.environ["SORT"]) if os.environ["SORT"] else 0,
    "lesson": lesson,
}, ensure_ascii=False))
PY

ROW="$(cat "$ROW_TMP")"

ID="$(printf '%s' "$ROW"    | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
TITLE="$(printf '%s' "$ROW" | python3 -c 'import json,sys;print(json.load(sys.stdin)["title"])')"
TOOL="$(printf '%s' "$ROW"  | python3 -c 'import json,sys;print(json.load(sys.stdin)["tool"] or "")')"
TRK="$(printf '%s' "$ROW"   | python3 -c 'import json,sys;print(json.load(sys.stdin)["track"] or "")')"
FEAT="$(printf '%s' "$ROW"  | python3 -c 'import json,sys;print("true" if json.load(sys.stdin)["featured"] else "false")')"
SRT="$(printf '%s' "$ROW"   | python3 -c 'import json,sys;print(json.load(sys.stdin)["sort"])')"
LESSON_JSON="$(printf '%s' "$ROW" | python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin)["lesson"], ensure_ascii=False, sort_keys=False))')"

ID_LIT="$(printf '%s' "$ID" | sql_literal)"
TITLE_LIT="$(printf '%s' "$TITLE" | sql_literal)"
TOOL_LIT="$( [ -n "$TOOL" ] && printf '%s' "$TOOL" | sql_literal || printf 'null' )"
TRACK_LIT="$( [ -n "$TRK" ] && printf '%s' "$TRK" | sql_literal || printf 'null' )"
LESSON_LIT="$(printf '%s' "$LESSON_JSON" | sql_literal)"

SQL="
insert into public.library_lessons (id, title, tool, track, featured, sort, published, lesson, published_at)
values ($ID_LIT, $TITLE_LIT, $TOOL_LIT, $TRACK_LIT, $FEAT, $SRT, true, ${LESSON_LIT}::jsonb, now())
on conflict (id) do update set
  title        = excluded.title,
  tool         = excluded.tool,
  -- A re-publish without --track keeps the track it was shelved under.
  track        = coalesce(excluded.track, public.library_lessons.track),
  featured     = excluded.featured,
  sort         = excluded.sort,
  published    = true,
  lesson       = excluded.lesson,
  published_at = coalesce(public.library_lessons.published_at, now())
returning id, title, track, featured, sort, published, published_at;
"

RES="$(printf '%s' "$SQL" | "$RUN_SQL")"
RES="$RES" python3 <<'PY'
import json, os, sys

raw = os.environ["RES"]
try:
    rows = json.loads(raw)
except Exception:
    print(raw, file=sys.stderr); sys.exit(1)
if isinstance(rows, dict):
    print("supabase error:", rows.get("message", rows), file=sys.stderr); sys.exit(1)
if not rows:
    print("upsert returned no row", file=sys.stderr); sys.exit(1)
r = rows[0]
print(f'published {r["id"]}  ({r["title"]})')
print(f'  track={r["track"]}  featured={r["featured"]}  sort={r["sort"]}  published_at={r["published_at"]}')
PY
