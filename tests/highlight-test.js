// The highlighter: a block you drag out, and a colour of its own.
//
// It is a marker, not a pen. What it lays down multiplies with what is under
// it, so white paper turns yellow and black words stay black and readable -
// paint it opaquely and you have covered up the thing you meant to point at.
// And it keeps its own colour: reaching for the highlighter and reaching for
// the pen are different hands, so picking yellow here must not leave the next
// arrow yellow too.
const { open, seedPhoto, pickTool, canvasBox, touch, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

// What the photo is, what the marker is, and what the two make between them.
const PHOTO = [61, 107, 143];      // #3d6b8f
const MARKER = [255, 224, 102];    // #ffe066, the default
const mul = (a, b) => a.map((v, i) => Math.round(v * b[i] / 255));

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13' });
  const { drag, tap } = await touch(page, ctx);
  const r = {};

  await seedPhoto(page, { width: 800, height: 500, colour: '#3d6b8f', name: 'shot.png' });

  // ---- It is a tool in the strip like any other ----
  r.inStrip = await page.evaluate(() => {
    const b = document.querySelector('[data-tool="highlight"]');
    if (!b) return null;
    const box = b.getBoundingClientRect();
    const text = b.querySelector('.tool-text');
    return {
      label: text ? text.textContent : null,
      // A word wider than the button it sits in is a word with its end cut
      // off: ten tools share a phone's width, so the label has to be short
      // enough to survive the division. Measured against the button, not
      // against itself - the span shrink-wraps its text, so its own
      // scrollWidth and clientWidth agree however far it overhangs.
      labelFits: text
        ? text.getBoundingClientRect().left >= box.left - 0.5 &&
          text.getBoundingClientRect().right <= box.right + 0.5
        : false,
      onScreen: box.left >= -1 && box.right <= window.innerWidth + 1,
      tall: Math.round(box.height),
    };
  });

  await pickTool(page, 'highlight');
  r.armed = await page.evaluate(() => ({
    tool,
    // Its colour, not the pen's: the swatch is showing what the marker will
    // lay down the moment it is picked up.
    swatch: document.getElementById('color').value,
    label: document.getElementById('lineGroupLabel').textContent,
    // A wash has no line thickness and no separate fill - the swatch is the
    // whole of it - so neither control is offered.
    sizeShown: !document.getElementById('size').classList.contains('hidden'),
    fillShown: !document.getElementById('fillGroup').classList.contains('hidden'),
  }));

  // ---- Drag a block, get a wash ----
  const box = await canvasBox(page);
  await drag(box.at(0.2, 0.3), box.at(0.6, 0.55), { steps: 6, settle: 400 });

  r.drawn = await page.evaluate(() => {
    const s = shapes[shapes.length - 1];
    return {
      count: shapes.length,
      type: s && s.type,
      // The block covers what the finger covered, in canvas units.
      box: s ? [Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h)] : null,
      // One gesture, one undo step, like every other tool.
      undoSteps: undoStack.length,
    };
  });

  r.wash = await page.evaluate(() => {
    const s = shapes[shapes.length - 1];
    const px = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    return {
      inside: px(s.x + s.w / 2, s.y + s.h / 2),
      // Just outside the block, the picture is untouched.
      outside: px(s.x + s.w / 2, s.y - 20),
    };
  });

  // Painted opaquely, a highlight would read exactly its own colour and would
  // have hidden whatever it was put over. Multiplied, it cannot: the darkest
  // channel of what is underneath survives.
  r.notOpaque = r.wash.inside.join() !== MARKER.join();

  // ---- Its colour is its own ----
  // The pen colour is a single global that a selected shape overwrites, so
  // "the highlighter remembers" has to survive both a tool change and a
  // selection.
  await page.evaluate(() => {
    const el = document.getElementById('color');
    el.value = '#00ff00';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await pickTool(page, 'rect');
  r.penUndisturbed = await page.evaluate(() => ({
    swatch: document.getElementById('color').value,
    pen: color,
  }));
  await pickTool(page, 'highlight');
  r.markerRemembers = await page.evaluate(() => document.getElementById('color').value);
  await drag(box.at(0.2, 0.7), box.at(0.5, 0.85), { steps: 6, settle: 400 });
  r.secondColour = await page.evaluate(() => shapes[shapes.length - 1].color);

  // ---- It behaves like any other block once it is down ----
  await pickTool(page, 'select');
  await tap(box.at(0.4, 0.42), { settle: 300 });
  r.selectable = await page.evaluate(() => ({
    type: selectedShape && selectedShape.type,
    handles: selectedShape ? getResizeHandles(selectedShape).length : 0,
    // Selecting a highlight must not drag its colour into the pen either.
    pen: color,
  }));

  // An arrow does not stick to a wash. Snapping is for boxes you draw round
  // things; a highlight is a mark on the picture, and an arrow that leapt to
  // its edge whenever one was drawn nearby would be unusable.
  r.noSnap = await page.evaluate(() => {
    const s = shapes.find(sh => sh.type === 'highlight');
    return getSnapTargetAtPoint(s.x + s.w / 2, s.y + s.h / 2) === null;
  });

  // ---- A wash over a torn edge, and after a reload ----
  // Multiply blends with what is under it, and under a torn edge there is
  // nothing: the strip the rip takes is cleared so an export keeps its alpha.
  // A wash that painted into that strip would put the corner of the page back.
  await page.evaluate(() => {
    shapes.length = 0;
    toggleTearEdge('bottom');
    shapes.push({ type: 'highlight', x: 100, y: canvas.height - 120, w: 400, h: 200,
                  rotation: 0, color: '#ffe066', id: newShapeId() });
    redraw();
  });
  await page.waitForTimeout(1400); // and let the debounced save land
  r.overTear = await page.evaluate(() => {
    const at = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const spot = [300, canvas.height - 1];
    const withWash = at(...spot);
    // The same pixel with the wash taken away. Compared rather than read
    // against zero: the strip is not empty, it carries the shadow that gives
    // the rip its depth, so "the wash stays on the paper" means it adds
    // nothing here, not that there is nothing here.
    const held = shapes.splice(0, shapes.length);
    redraw();
    const without = at(...spot);
    shapes.push(...held);
    redraw();
    return {
      onPaper: at(300, canvas.height - 100).slice(0, 3),
      ripUnchanged: withWash.join() === without.join(),
      ripAlpha: withWash[3],
    };
  });

  await page.reload();
  await page.waitForTimeout(1400);
  r.afterReload = await page.evaluate(() => {
    const s = shapes[0];
    return {
      count: shapes.length,
      type: s && s.type,
      colour: s && s.color,
      // Still a wash, not a slab: the type came back and so did how it paints.
      pixel: [...ctx.getImageData(300, Math.round(canvas.height - 100), 1, 1).data].slice(0, 3),
    };
  });
  // Back to two plain washes on an untorn page for the last question.
  await page.evaluate(() => {
    toggleTearEdge('bottom');
    shapes.length = 0;
    for (const y of [80, 300]) {
      shapes.push({ type: 'highlight', x: 100, y, w: 400, h: 90,
                    rotation: 0, color: '#ffe066', id: newShapeId() });
    }
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(300);

  // ---- And it is an annotation ----
  await page.evaluate(() => { selectedShape = null; document.getElementById('clear').click(); });
  await page.waitForTimeout(250);
  r.clearSummary = await page.evaluate(() => document.getElementById('clearSummary').textContent);
  await page.click('#clearShapesBtn');
  await page.waitForTimeout(400);
  r.afterClear = await page.evaluate(() => shapes.length);

  r.errors = realErrors(errors);
  finish(r, {
    'inStrip.label': v => typeof v === 'string' && v.length > 0,
    'inStrip.labelFits': isTrue,
    'inStrip.onScreen': isTrue,
    'inStrip.tall': near(44, 1),

    'armed.tool': 'highlight',
    'armed.swatch': '#ffe066',
    // The swatch sets the colour of a wash and nothing else, so the row stops
    // calling itself Line over it - the same treatment text gets.
    'armed.label': 'Colour',
    'armed.sizeShown': isFalse,
    'armed.fillShown': isFalse,

    'drawn.count': 1,
    'drawn.type': 'highlight',
    'drawn.box': [160, 150, 320, 125],
    'drawn.undoSteps': 1,

    'wash.inside': mul(PHOTO, MARKER),
    'wash.outside': PHOTO,
    'notOpaque': isTrue,

    // The pen is still the pen: black, and its swatch showing black.
    'penUndisturbed.pen': '#333333',
    'penUndisturbed.swatch': '#333333',
    'markerRemembers': '#00ff00',
    'secondColour': '#00ff00',

    'selectable.type': 'highlight',
    'selectable.handles': atLeast(4),
    'selectable.pen': '#333333',
    'noSnap': isTrue,

    'overTear.onPaper': mul(PHOTO, MARKER),
    'overTear.ripUnchanged': isTrue,
    // Reported, not asserted: what the rip does carry is the tear's own shadow.

    'afterReload.count': 1,
    'afterReload.type': 'highlight',
    'afterReload.colour': '#ffe066',
    'afterReload.pixel': mul(PHOTO, MARKER),

    'clearSummary': '2 shapes on an image.',
    'afterClear': 0,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
