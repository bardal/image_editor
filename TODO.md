# Work list

Decided work that has not been built yet. Nothing carries between sessions
except this file, `CLAUDE.md` and the tests, so an item here needs enough detail
to act on cold: what to build, why that shape and not another, and what would
have to fail first.

Delete an item when it ships. If it turns out to be wrong, say so here rather
than deleting it quietly.

## Next

Nothing decided and unbuilt.

## Built

### The desktop toolbar wraps rather than running off the edge

At 1440 it wanted 1500px with the rect tool and 1776 with callout, so the
property controls sat off the right-hand edge. It takes a second row now, as
the phone bar does, and `calculateCanvasSize` measures the bar rather than
assuming 40px. `desktop-test` asserts every control is inside the window at
1440 and 1280, under three tools.

### The desktop row and the phone row share one implementation

Ten base rules described those controls and fifty-three phone rules overrode
them, which is why fixing the phone left the desk crooked - two implementations
of one row. The kit and the track are base rules now; `@media (pointer: coarse)`
sets `--ctl-h: 44px` and nothing else about them; the phone block keeps only
placement - pinning, wrapping, what is hidden, the floating pair. `desktop-test`
asserts the edges at 1440 as `layout-test` does at 390.

## Built

### Fuse the property row into one track

The drawing property row (`.toolbar-props` — line colour, thickness, fill, arrow
ends, text format) reads as loose furniture: five different control heights whose
box edges land on three different lines, borders on some controls and not others,
and one hairline divider carrying all the grouping.

It looks crooked while measuring perfectly straight. Every element on the row
reports the same centre — `mid = 19.5` for all fourteen — because the eye aligns
**edges**, not midpoints, and the row has boxes of 30, 28, 24, 16 and 4 pixels.

Build the fused track: one inset container for the whole property area, controls
fused edge to edge inside it, groups separated by internal 1px rules rather than
gaps. Tightest row on a narrow screen, and it reads as one instrument instead of
seven loose items.

The shared control kit it rests on:

```css
.toolbar-props {
    --ctl-h: 28px;
    --ctl-r: 6px;
    --ctl-bg: rgba(255,255,255,0.06);
    --ctl-bd: rgba(255,255,255,0.13);
}

/* Coarse pointer keeps the 44px target it already has, with the visible
   box growing to match rather than floating inside it. */
@media (pointer: coarse) {
    .toolbar-props { --ctl-h: 34px; }
}
```

Every box on the row takes `--ctl-h`, `--ctl-r`, and the one border: the swatches,
the arrow-style selects, the text-format selects and number field, the format
buttons, and a new box around the width slider that takes the loose readout
inside it. All of it is furniture — `screenPx`, finger-sized at any zoom, never
canvas units.

Three things to get right, in the order they will bite:

- **Fused corners have to be recomputed whenever a group hides.** Only the first
  and last visible box in a run carries a rounded corner, and which box that is
  changes with the tool. This is the whole risk of the fused shape over a plainer
  one, and it is exactly the kind of rule that goes wrong quietly — a group hides
  and a square corner is left mid-run with nothing to say it is wrong. Drive it
  off `:first-child`/`:last-child` of the visible run, not off tool names.
- **Bold and italic become boxes.** `B` and `I` are bare glyphs today with no
  border and no background, so they read as text rather than controls while the
  dropdowns beside them read as the only real ones.
- **One label voice.** `LINE` is 10px/600 caps in `#8a8a90`; `Start:` is 11px/500
  sentence case in `#adadb2`; the width readout is a third setting again. Pick the
  caps one, and drop the colons from `Start:` and `End:`.

Built on a phone. The fused-corner risk below was designed out rather than
solved: the track clips its own corners, so no rule has to work out which box
is first or last in a visible run.

**Write the failing test first, and not on centres — the row already passes
those.** Collect every box in `.toolbar-props` and assert they share a top edge
and a bottom edge to within a pixel, for each tool in turn. Against today's code
it fails on the rect row with three distinct tops, which is the fault as
reported. A test on midpoints goes green on the broken row and would have missed
this for another year.

A native `select` ignores most height on iOS, so the dropdowns need a real look on
the phone. The suites cannot confirm that; Chromium emulating an iPhone is not
Safari.

Mock-ups, measurements and the two rejected alternatives (a plainer one-height
pass, and per-group wells):
https://claude.ai/code/artifact/556fd32f-8b29-4716-829f-aff6079dea03

## Built

### The icons, drawn as a set, in bordered chips

Built with the chips (option 2), not the bordered strip the artifact
recommended - the call was made looking at both. `icons-test` renders each
symbol on its own and weighs the ink: every glyph now centres on 12,12 where
Tear was on 10.5 and Arrow on 11, and none reaches past 16.5 of 24 where Crop
was 21 x 22.

One claim in the artifact did not survive the measurement: the redrawn set was
described as cutting the spread of ink from 2.8x to 1.4x. On what actually
renders it is 2.97x, against 3.05x before - barely moved. A page outline with
nine zigzags carries more line than a single diagonal at the same weight, and
redrawing cannot change that. The set's real gain is where the glyphs sit and
how far they reach.

Finished across the whole sprite rather than the nine tools: the file actions,
the four tear-edge icons and the info mark were drawn to the same loose grid
and went through the same pass. Twenty-one symbols, every one centred on 12,12
and none reaching past 16.5 of 24. They were re-fitted rather than redrawn -
every coordinate scaled about the drawing's own centre and moved to sit in the
middle of the box, so the shapes are untouched and the stroke stays 1.8 for
all of them.
