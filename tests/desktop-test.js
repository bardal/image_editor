const { open, canvasBox, pickTool, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 }, settle: 200, reset: false });

  const r = {};
  r.coarsePointer = await page.evaluate(() => isCoarsePointer());

  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#ccddaa'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; resizeCanvas(); updateImageInfo();
  });
  await page.waitForTimeout(150);

  r.scaleFactor = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return +(canvas.width / b.width).toFixed(2);
  });

  // Mouse drag to draw a rectangle.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  const b = await canvasBox(page);
  await page.mouse.move(b.x + b.w * 0.2, b.y + b.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w * 0.6, b.y + b.h * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  r.shapesAfterMouseDrag = await page.evaluate(() => shapes.length);

  // Mouse select + the effective stroke width in screen px.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  r.strokeScreenPx = await page.evaluate(() => {
    const bb = canvas.getBoundingClientRect();
    return +(strokeWidth(3) / (canvas.width / bb.width)).toFixed(2);
  });
  r.handleScreenPx = await page.evaluate(() => {
    const bb = canvas.getBoundingClientRect();
    return +(UI.resizeHit / (canvas.width / bb.width)).toFixed(1);
  });

  // Double-click to add a label (mouse path must still work).
  const mid = await page.evaluate(() => {
    const s = shapes[0]; const bb = canvas.getBoundingClientRect();
    return {
      x: bb.x + (s.x + s.w / 2) / (canvas.width / bb.width),
      y: bb.y + (s.y + s.h / 2) / (canvas.height / bb.height),
    };
  });
  await page.mouse.dblclick(mid.x, mid.y);
  await page.waitForTimeout(150);
  r.labelEditorOpened = await page.evaluate(() =>
    document.getElementById('canvasTextInput').style.display !== 'none');

  // The label editor from the double-click above is still open; dismiss it so
  // the text-tool checks below start from a clean state.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- Text tool with a real mouse ----
  // A mouse press moves focus to the document by default; if that lands after
  // the input is focused it blurs it and commits empty text instantly. Touch
  // does not behave this way, so only a mouse test catches it.
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  const tb = await canvasBox(page);
  await page.mouse.click(tb.x + tb.w * 0.35, tb.y + tb.h * 0.35);
  await page.waitForTimeout(150);
  // Text blocks now use the multi-line editor, shared with callouts.
  r.textStaysFocusedAfterClick = await page.evaluate(() =>
    isEditingText && document.activeElement === document.getElementById('calloutTextInput'));
  await page.keyboard.type('Typed on PC');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(200);
  r.textCommitted = await page.evaluate(() =>
    shapes.filter(s => s.type === 'text').map(s => s.text));

  // Clicking existing text with the text tool must edit it, not stack a new one.
  // Measured again: the property row changes what it holds as text is placed,
  // so a coordinate taken before that is a coordinate somewhere else.
  const tb2 = await canvasBox(page);
  await page.mouse.click(tb2.x + tb2.w * 0.35 + 20, tb2.y + tb2.h * 0.35 + 5);
  await page.waitForTimeout(150);
  r.reopensExistingText = await page.evaluate(() =>
    document.getElementById('calloutTextInput').value);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // Line thickness is meaningless for text; the swatch label should say so.
  await pickTool(page, 'text');
  r.textPropLabel = await page.evaluate(() => {
    return {
      label: document.getElementById('lineGroupLabel').textContent,
      sliderHidden: document.getElementById('size').classList.contains('hidden'),
    };
  });
  await pickTool(page, 'rect');
  r.rectPropLabel = await page.evaluate(() => {
    return {
      label: document.getElementById('lineGroupLabel').textContent,
      sliderHidden: document.getElementById('size').classList.contains('hidden'),
    };
  });

  r.pageErrors = realErrors(errors);
  // ---- The property row, at a desk ----
  // The same row and the same fault as on a phone: it measures straight on its
  // centres and reads crooked, because the eye aligns edges and the boxes are
  // different heights. Fixing it on the phone left this one alone, because the
  // two were separate implementations of one row.
  r.rowEdges = {};
  for (const t of ['rect', 'arrow', 'text']) {
    await pickTool(page, t, 180);
    r.rowEdges[t] = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(
        '.toolbar-props .swatch, .toolbar-props .swatch-label, .toolbar-props .slider-box,'
        + ' .toolbar-props .fill-toggle, .toolbar-props select, .toolbar-props .cap-btn,'
        + ' .toolbar-props input[type="number"], .toolbar-props .format-btn')]
        .map(el => el.getBoundingClientRect()).filter(b => b.width > 0);
      const tops = [...new Set(boxes.map(b => Math.round(b.top)))].sort((a, b) => a - b);
      const bottoms = [...new Set(boxes.map(b => Math.round(b.bottom)))].sort((a, b) => a - b);
      const heights = [...new Set(boxes.map(b => Math.round(b.height)))].sort((a, b) => a - b);
      return { count: boxes.length, tops, bottoms, heights,
               linedUp: tops[tops.length - 1] - tops[0] <= 1
                     && bottoms[bottoms.length - 1] - bottoms[0] <= 1 };
    });
  }

  // ---- Nothing off the right-hand edge ----
  // The toolbar is one row of file actions, nine tools and the property track,
  // and it did not wrap: at 1440 it wanted 1500 for rect and 1776 for callout,
  // so the property controls sat off the edge with nothing to say they were
  // there. The same fault the phone bar had, and the same answer - take another
  // row rather than run past the edge.
  r.fitsAtWidth = {};
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    r.fitsAtWidth[width] = {};
    for (const t of ['rect', 'text', 'callout']) {
      await pickTool(page, t, 180);
      r.fitsAtWidth[width][t] = await page.evaluate(() => {
        const bar = document.querySelector('.toolbar');
        const offScreen = [];
        bar.querySelectorAll('button, select, input, label').forEach(el => {
          const b = el.getBoundingClientRect();
          if (!b.width && !b.height) return;
          if (b.right > window.innerWidth + 1 || b.left < -1) {
            offScreen.push(el.id || el.className.split(' ')[0]);
          }
        });
        return {
          offScreen,
          barHeight: Math.round(bar.getBoundingClientRect().height),
          // The canvas has to keep clear of however many rows it took.
          canvasBelowBar: document.getElementById('canvas').getBoundingClientRect().top
            >= bar.getBoundingClientRect().bottom - 1,
        };
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  // And one implementation, not two: the controls take their size from the kit
  // rather than from a block of phone overrides.
  r.oneKit = await page.evaluate(() => {
    const props = document.querySelector('.toolbar-props');
    const h = getComputedStyle(props).getPropertyValue('--ctl-h').trim();
    const box = document.querySelector('.toolbar-props .swatch').getBoundingClientRect();
    return { ctlH: h, swatchHeight: Math.round(box.height) };
  });

  finish(r, {
    'rowEdges.rect.linedUp': isTrue,
    'rowEdges.arrow.linedUp': isTrue,
    'rowEdges.text.linedUp': isTrue,
    'fitsAtWidth.1440.rect.offScreen': isEmpty,
    'fitsAtWidth.1440.text.offScreen': isEmpty,
    'fitsAtWidth.1440.callout.offScreen': isEmpty,
    'fitsAtWidth.1440.callout.canvasBelowBar': isTrue,
    'fitsAtWidth.1280.rect.offScreen': isEmpty,
    'fitsAtWidth.1280.text.offScreen': isEmpty,
    'fitsAtWidth.1280.callout.offScreen': isEmpty,
    'fitsAtWidth.1280.callout.canvasBelowBar': isTrue,
    'oneKit.ctlH': v => typeof v === 'string' && v.length > 0,
    'oneKit.swatchHeight': v => v === parseInt(r.oneKit.ctlH),
    'coarsePointer': isFalse,
    'shapesAfterMouseDrag': 1,
    'strokeScreenPx': atLeast(2),
    'handleScreenPx': atLeast(6),
    'labelEditorOpened': isTrue,
    // A mouse press moves focus to the document by default; this is the check
    // that placing text on a PC no longer commits itself instantly.
    'textStaysFocusedAfterClick': isTrue,
    'textCommitted': ['Typed on PC'],
    'reopensExistingText': 'Typed on PC',
    'textPropLabel.label': 'Colour',
    'textPropLabel.sliderHidden': isTrue,
    'rectPropLabel.label': 'Line',
    'rectPropLabel.sliderHidden': isFalse,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
