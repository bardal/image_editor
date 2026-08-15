#!/usr/bin/env bash
# Runs every suite against a local server.
#
# The app needs a real origin: IndexedDB, the clipboard and the service worker
# are all unavailable over file://, so persistence and paste cannot be tested
# there.
#
# A suite passes when it exits zero. Each one ends with finish() from expect.js,
# which checks the report and exits non-zero on a wrong value or a page error -
# so a failure here means behaviour changed, not just that the page threw.
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
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "ok"; pass=$((pass+1)); continue
  fi
  echo "FAILED"
  # Print the reasons if the suite reported them, otherwise whatever it said
  # before it died.
  reasons=$(echo "$output" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const d=JSON.parse(s); (d.failures||[]).forEach(f => console.log("  - " + f)); }
      catch { }
    });')
  if [ -n "$reasons" ]; then echo "$reasons"; else echo "$output" | tail -8; fi
  fail=$((fail+1))
done

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
