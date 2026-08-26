#!/bin/bash
# Gets a fresh web session ready to run the suites.
#
# The app itself has no dependencies and no build step, so the only thing an
# editing session needs installed is the test runner - and a session that cannot
# run the suites tends not to run them at all.
set -euo pipefail

# A local checkout has its own node_modules already; the containers start empty
# every time, which is what this is for.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# install, not ci: the container image is cached once this has run, and install
# can reuse whatever is already unpacked there.
npm install --no-audit --no-fund >/dev/null

# Which browser the suites will drive - tests/browser.js decides, and prints
# nothing on its own, so a session that has no browser at all learns it here
# rather than from 26 suites failing at launch. An empty answer means
# Playwright's own, which is the ordinary case.
browser=$(node -e 'process.stdout.write(require("./tests/browser").path() || "")' 2>/dev/null || true)
if [ -z "$browser" ]; then
  # Nothing to fall back on. Ask Playwright for its own and carry on either way:
  # a session with no browser can still edit the app, and the suites say so
  # plainly when they cannot start one.
  npx --yes playwright install chromium >/dev/null 2>&1 || true
fi

echo "Ready. Run the suites with: ./tests/run-all.sh"
