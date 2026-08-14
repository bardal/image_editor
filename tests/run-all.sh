#!/usr/bin/env bash
# Runs every suite against a local server.
#
# The app needs a real origin: IndexedDB, the clipboard and the service worker
# are all unavailable over file://, so persistence and paste cannot be tested
# there.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
export APP_URL="${APP_URL:-http://127.0.0.1:$PORT/index.html}"

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 2

pass=0; fail=0
for suite in tests/*-test.js; do
  name=$(basename "$suite" -test.js)
  printf '%-16s' "$name"
  output=$(node "$suite" 2>&1)
  if [ $? -ne 0 ]; then
    echo "FAILED"; echo "$output" | tail -5; fail=$((fail+1)); continue
  fi
  errs=$(echo "$output" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const d=JSON.parse(s); const e=d.errors||d.pageErrors||[];
            console.log(e.length ? JSON.stringify(e) : ""); }
      catch { console.log("unparseable output"); }
    });')
  if [ -z "$errs" ]; then echo "ok"; pass=$((pass+1))
  else echo "errors: $errs"; fail=$((fail+1)); fi
done

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
