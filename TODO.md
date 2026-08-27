# Work list

Decided work that has not been built yet. Nothing carries between sessions
except this file, `CLAUDE.md` and the tests, so an item here needs enough detail
to act on cold: what to build, why that shape and not another, and what would
have to fail first.

Delete an item when it ships. If it turns out to be wrong, say so here rather
than deleting it quietly.

## Next

### Give the desktop row the same track

The phone row is fused (see below - built). The desktop one still carries the
old mixed heights, dividers and per-control borders, and has the same fault:
the eye aligns edges, and that row has none. It is a different arrangement -
inline in the top toolbar rather than a bar of its own - so the kit transfers
but the container does not. `layout-test` asserts the edges on a phone only;
the desktop assertion wants writing at the same time.

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

## Found, not yet decided

### The tool icons were never drawn as a set

The nine tool buttons are fine — same 24px box, same 20px icon slot, all centred.
The drawings inside them are not: nine glyphs at nine sizes on the same 24-unit
grid. Crop covers 2.8× the ink area of Select and reaches y 2–22 of 24, the only
glyph touching its edges. Tear centres on 10.5 where every other glyph centres on
12, so it rides about 1.25px high. The strip itself has `rgba(0,0,0,0.2)` on
`#252528` and no border, so nine tools read as loose glyph-and-word pairs.

A redrawn set exists — every glyph built symmetrically about (12, 12), none
exceeding a 13.4 × 13.4 live area, ink-area spread down from 2.8× to 1.4× — along
with two ways to give the strip an edge. Not chosen yet:
https://claude.ai/code/artifact/c5c20c15-c4fd-42ff-bbda-f273071af88a

If it goes ahead, the four `i-tear-*` edge icons and the top-bar file actions were
drawn to the same loose grid and want the same pass. Fix the family, not the
instance.
