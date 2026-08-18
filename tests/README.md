# Tests

Browser tests driven by Playwright against a real Chromium. There is no build
step for the app itself; these only need Node and Playwright.

    npm install
    ./tests/run-all.sh

`run-all.sh` serves the repo over HTTP and runs every `*-test.js`. Override the
target with `APP_URL`, or the browser binary with `CHROME_PATH`.

Every push and pull request runs the same command in CI, and nothing is
published to Pages until it passes — see `.github/workflows/pages.yml`.

## How a suite passes

Each suite builds a report object and ends with `finish(report, rules)` from
`expect.js`. A rule names a field and the value or predicate it must match; a
mismatch, or any page error, prints the reason and exits non-zero.

    finish(r, {
      'afterTapAway.callouts': 1,
      'doneBarVisible.onScreen': isTrue,
      'scaleFactor': atLeast(5),
    })

This matters more than it sounds. The suites used to print their report and
exit zero whatever it said, so the runner could only catch a crash. Two faults
sat in a green run for days: text stopped reopening when clicked, and two
callout touch checks stopped exercising the callout tool at all. Both showed
plainly in the printed output and both were reported as "ok".

Fields not named by a rule are still printed. That keeps diagnostics — sizes,
positions, pixel samples — useful without freezing values that are allowed to
drift.

The app must be served over HTTP rather than opened as a file: IndexedDB, the
clipboard and the service worker are all unavailable over `file://`, so
persistence and paste cannot be exercised there.

## Why both touch and mouse

Several bugs have only ever appeared on one of the two:

- Placing text committed instantly with a mouse but not by touch, because a
  mouse press moves focus to the document by default and blurred the input.
- Hesitating before a drag opened the context menu and lost the gesture.
- Callouts had only mouse coverage, which is why two touch faults survived.

Suites using `devices['iPhone 13']` drive real touch events through CDP;
`desktop-test.js` drives a mouse. Anything touching input should be covered by
both.

## Not covered

Two things are deliberately absent. HEIC conversion needs the CDN library and a
real HEIC file. And every "phone" suite is Chromium emulating an iPhone, not
Safari: the two worst faults this app has had were Safari behaviours Chromium
does not reproduce - the force-zoom on a sub-16px field, and the synthesised
mouse events after a tap. What the suites assert there are proxies for what
Safari is believed to do. If that belief is wrong, they stay green and the phone
does not.

## Suites

| Suite | Covers |
| --- | --- |
| `regression` | Previously fixed faults: long press stealing a drag, a stranded block edit, Escape destroying a callout |
| `callout` / `callout-touch` | Callouts by mouse and by touch: creation, wrapping, tip and box independence, re-editing |
| `blockedit` | Editing text on a phone: the editor stays at 16px or more so Safari cannot zoom the page, Done/Cancel are reachable, and tapping away commits instead of creating another shape |
| `textblock` | Wrapping, growth, width handles, and that text and callouts share one implementation |
| `zoom` | Pinch zoom, pan, stroke width fixed to the image, drawing while zoomed |
| `pinch` | The spot between your fingers staying put, out-and-back without creeping, and enough bitmap for the screen at any zoom |
| `menu` | Long-press and right-click menus, duplicate, stacking order |
| `crop` | Crop, expand, transparent margins, reset |
| `clear` | Clearing the drawing, everything, and what survives a reload |
| `persist` | Shapes, image and crop surviving a reload |
| `reflow` | The drawing keeping its place when the blank canvas is re-sized: address bar, rotation, and a document saved on a differently sized canvas |
| `touch` / `keyboard` | Touch drawing, hit target sizes, the on-screen keyboard |
| `line` | Drag adds a segment, tap ends it |
| `desktop` | Mouse drawing, text entry, labels |
| `layout` | Phone layout: pinned bars, nothing unreachable, tap targets |
| `rotate` | Rotating a rect, an ellipse and a text block by mouse and by touch, and the handle staying clear of the shape |
| `export` | The saved PNG: full resolution, follows a crop, and carries no selection outline or handles |
| `undo` | Every kind of change being its own step - draw, move, resize, delete, text edit, colour |
| `controls` | Colour, stroke width, fill, font family and size, bold, italic, alignment, arrow ends |
| `connector` | Arrows snapping to shapes, re-routing when one moves, going when it goes |
| `misc` | Paste, closing a polygon, shape labels, cycling a stack, the service worker |
