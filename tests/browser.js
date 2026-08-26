// Which Chromium the suites drive.
//
// A suite used to launch whatever CHROME_PATH named, and otherwise let
// Playwright find the browser it had downloaded for itself. Neither is a given:
// a sandbox may ship a Chromium at a fixed path instead, built for a different
// Playwright and with downloads switched off. Every suite then died at launch,
// and 26 identical failures read like the app was broken rather than the
// browser being somewhere else.
//
// So the search lives here, in one place, and each suite asks for a path rather
// than deciding for itself. CI is unaffected: it installs Playwright's own
// browser, which still wins over anything the sandbox provides.
const fs = require('fs');

function path() {
    // An explicit choice is honoured whatever else is around.
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

    // undefined, not a path: this is Playwright's own, and it knows where that
    // is better than we do.
    try {
        if (fs.existsSync(require('playwright').chromium.executablePath())) return undefined;
    } catch (err) {
        // Not installed, or a version that will not answer. Fall through.
    }

    const candidates = [];
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        candidates.push(process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium');
    }
    candidates.push('/opt/pw-browsers/chromium');
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch (err) {
            // Not there; try the next.
        }
    }

    // Nothing found. Hand back undefined so Playwright reports the miss in its
    // own words, which name the command that fixes it.
    return undefined;
}

module.exports = { path };
