// Turns a suite's report into a pass or a fail.
//
// The suites used to print JSON and exit zero whatever it said, so the runner
// could only catch a crash or a page error. A wrong value - a tip that never
// moved, text that came back empty - was printed and called "ok". Every suite
// now ends with finish(), which checks the report against the behaviour the
// suite is there to protect and exits non-zero when it does not hold.

// Reads 'a.b.c' out of the report so a rule can point at one field.
function at(report, path) {
    return path.split('.').reduce((o, k) => (o === null || o === undefined ? o : o[k]), report);
}

// Rules are { 'path.to.field': expected }, where expected is either a value to
// match or a predicate. Anything not mentioned is reported but not enforced,
// which keeps diagnostic fields useful without freezing them.
function check(report, rules) {
    const failures = [];
    for (const [path, want] of Object.entries(rules)) {
        const got = at(report, path);
        let ok;
        try {
            ok = typeof want === 'function' ? !!want(got) : JSON.stringify(got) === JSON.stringify(want);
        } catch (err) {
            ok = false;
        }
        if (!ok) {
            const wanted = typeof want === 'function' ? want.name || 'predicate' : JSON.stringify(want);
            failures.push(`${path}: got ${JSON.stringify(got)}, wanted ${wanted}`);
        }
    }
    return failures;
}

// Page errors sink a suite whichever key it collected them under.
function pageErrorsOf(report) {
    const found = report.errors || report.pageErrors || [];
    return Array.isArray(found) ? found : [found];
}

function finish(report, rules) {
    const failures = check(report, rules || {});
    for (const err of pageErrorsOf(report)) failures.push(`page error: ${err}`);
    report.failures = failures;
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
}

// Handy predicates, named so a failure says what was wanted.
const isTrue = v => v === true;
const isFalse = v => v === false;
const isEmpty = v => Array.isArray(v) && v.length === 0;
function named(label, fn) {
    Object.defineProperty(fn, 'name', { value: label });
    return fn;
}
const atLeast = n => named(`>= ${n}`, v => typeof v === 'number' && v >= n);
const near = (n, slack) => named(`${n} +/- ${slack}`,
    v => typeof v === 'number' && Math.abs(v - n) <= slack);

module.exports = { finish, check, isTrue, isFalse, isEmpty, atLeast, near };
