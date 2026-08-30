# Tests

Browser tests driven by Playwright against a real Chromium. There is no build
step for the app itself; these only need Node and Playwright.

    npm install
    ./tests/run-all.sh

`run-all.sh` serves the repo over HTTP and runs every `*-test.js`. Override the
target with `APP_URL`, or the browser binary with `CHROME_PATH`.

Without `CHROME_PATH`, `browser.js` picks the browser: Playwright's own where it
has been downloaded, otherwise one the sandbox ships at a fixed path. Some
containers carry a Chromium built for a different Playwright and switch
downloads off, and every suite then failed at launch - 26 identical failures
that read like the app was broken rather than the browser being elsewhere.

Every push and pull request runs the same command in CI, and nothing is
published to Pages until it passes — see `.github/workflows/pages.yml`.

## Two units, and which to use

Nearly every visual fault this app has had was one mistake: a size in the wrong
unit. There are two.

- `fitPxToCanvas` — **part of the picture**. Fixed against the image, so it
  grows on screen as you zoom, like everything else in the drawing. Stroke
  widths, text, padding, corner radii, arrowheads, and the geometry of a shape
  a gesture creates.
- `screenPxToCanvas` — **something you touch, or something drawn over the
  picture**. Fixed on the glass, so it stays finger-sized whatever the zoom.
  Handles, hit tolerances, the crop frame, previews, port dots.

A raw number is almost always wrong: it means canvas units, which shrink to
nothing on a big photo — 20 units is 2 screen pixels on a 4032px image.

Getting it backwards is invisible at 100% and only shows up zoomed in, which is
why these kept reaching a phone. `units-test.js` pins the ones that belong to
the picture.

## What a suite does not have to write

`harness.js` holds the part that is the same in every suite: opening the app
(`open({ device })` or `open({ viewport })`, which wipes the stored document
and reloads unless told not to), loading a flat photo of a known size
(`seedPhoto`), putting a tool in hand (`pickTool`), finding the canvas
(`canvasBox`), and touch gestures (`touch(page, context)` → `tap`, `drag`,
`pinch`). Gesture timings are options
because they are load-bearing - a hold before the first move is what tells a
long press from a drag - so a suite written around particular numbers keeps
them.

Use `pickTool(page, name)` rather than clicking the button: a second press on
the tool already in hand puts it down and leaves Select in its place, so
pressing the button and picking the tool are no longer the same thing. Three
suites were pressing a tool they already held and only noticed when that
changed - the tap that followed drew nothing.

It was written after the seeding block had thirteen copies and one of them, in
`clear-test`, was quietly broken: it returned `page.evaluate` without calling
it, so every "image" case in that suite ran with no image loaded and passed
anyway. Thirteen copies is thirteen places for that to happen.

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

## Shape, not just state

A control can render as nonsense while every assertion about its state passes.
The fill switch was sized 20x20 by a touch rule, which turned the pill into a
circle and left its knob hanging outside the body when on: a grey blob that
read as nothing. Nothing failed, because nothing looked.

`layout-test` therefore checks the shapes: nothing a control paints inside
itself - a child or a pseudo-element - escapes its box, every tap target is
44px tall, both colour chips are the same size, and the switch's knob stays
inside its body at both ends of its travel. Height is the tap figure that has
to hold; a dense row of glyph buttons may be narrower, as the iOS keyboard is.

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

Three things are deliberately absent. HEIC conversion needs the CDN library and
a real HEIC file. The iOS share sheet cannot be opened by Chromium, so what
`export` checks is the branch taken and the file handed to `navigator.share` -
whether Apple's sheet then offers Save Image is for a real phone. And every "phone" suite is Chromium emulating an iPhone, not
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
| `tear` | Torn edges: the strip really goes, only the chosen edge, depth, undo, and what a reload brings back |
| `clear` | Clearing the drawing, everything, what survives a reload, and the single bin that deletes a selection or offers to clear |
| `persist` | Shapes, image and crop surviving a reload |
| `reflow` | The drawing keeping its place when the blank canvas is re-sized: address bar, rotation, and a document saved on a differently sized canvas |
| `touch` / `keyboard` | Touch drawing, hit target sizes, the on-screen keyboard |
| `line` | Drag adds a segment, tap ends it |
| `desktop` | Mouse drawing, text entry, labels |
| `layout` | Phone layout: pinned bars, every control on screen without scrolling sideways, tap targets |
| `rotate` | Rotating a rect, an ellipse and a text block by mouse and by touch, and the handle staying clear of the shape |
| `export` | The saved PNG: full resolution, follows a crop, carries no selection outline or handles, is named after the picture it came from, and goes to the share sheet where there is one |
| `undo` | Every kind of change being its own step - draw, move, resize, delete, text edit, colour |
| `controls` | Colour, stroke width, fill, font family and size, bold, italic, alignment, arrow ends, and a fill colour chosen on a phone reaching the shape |
| `connector` | Arrows snapping to shapes, re-routing when one moves, going when it goes |
| `misc` | Paste, closing a polygon, shape labels, cycling a stack, the service worker |
| `blockmove` | Tap to edit, drag to move, for a callout or a text block under any tool |
| `icons` | Every symbol in the sprite as a set, and the invariant that everything you touch is one height and every glyph one size, at either screen size: each rendered on its own and weighed - centred in its box, none reaching the edges - and the bordered chips they sit in |
| `units` | Sizes in the right unit: padding, corners and stroke keeping their proportion to the text at any zoom, shapes made while zoomed coming out the same, editors above the 16px iOS floor |
