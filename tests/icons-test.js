// The nine tool glyphs were drawn one at a time rather than as a set: nine
// sizes on the same 24-unit grid. Crop covered 2.8x the ink of Select and was
// the only glyph touching its box edges; Tear centred on 10.5 where every
// other centres on 12, so it rode about a pixel high in a button that measured
// perfectly square. Nothing about the buttons was wrong, which is why no test
// of the buttons ever caught it.
//
// This measures the drawings themselves: each symbol is rendered on its own at
// four times size, and the ink it leaves is weighed and located.
const { open, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  let { browser, page, errors } = await open({ viewport: { width: 1200, height: 800 }, reset: false });

  const r = {};

  // Every symbol in the sprite, not only the nine tools: the file actions and
  // the four tear-edge icons were drawn to the same loose grid, and a set that
  // stops at the tools is not a set.
  r.glyphs = await page.evaluate(async () => {
    const ids = [...document.querySelectorAll('.icon-sprite symbol')].map(el => el.id);
    // Select is drawn filled in the app; the rest are strokes.
    const filled = new Set(['i-select']);
    const SCALE = 4, SIZE = 24 * SCALE;

    const inkOf = async (id) => {
      const symbol = document.getElementById(id);
      const paint = filled.has(id)
        ? 'fill="#000" stroke="none"'
        : 'fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"`
        + ` width="${SIZE}" height="${SIZE}"><g ${paint}>${symbol.innerHTML}</g></svg>`;
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = rej; image.src = url; });
      const cv = document.createElement('canvas');
      cv.width = SIZE; cv.height = SIZE;
      const g = cv.getContext('2d');
      g.drawImage(image, 0, 0);
      const data = g.getImageData(0, 0, SIZE, SIZE).data;

      let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1, ink = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const a = data[(y * SIZE + x) * 4 + 3];
          if (a < 24) continue;
          ink += a / 255;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      const u = v => +(v / SCALE).toFixed(2);
      return {
        // Where the drawing sits, in the 24-unit box it is drawn in.
        centreX: u((minX + maxX + 1) / 2),
        centreY: u((minY + maxY + 1) / 2),
        width: u(maxX - minX + 1),
        height: u(maxY - minY + 1),
        // How much of the box it covers: the eye reads weight, not extent.
        ink: +(ink / (SCALE * SCALE)).toFixed(1),
      };
    };

    const out = {};
    for (const id of ids) out[id.slice(2)] = await inkOf(id);
    return out;
  });

  const all = Object.values(r.glyphs);
  const inks = all.map(g => g.ink);
  r.set = {
    // Every glyph built about the middle of its own box.
    offCentre: Object.entries(r.glyphs)
      .filter(([, g]) => Math.abs(g.centreX - 12) > 0.6 || Math.abs(g.centreY - 12) > 0.6)
      .map(([n, g]) => `${n} ${g.centreX},${g.centreY}`),
    // None of them reaching the edges of the box while its neighbours sit well
    // inside theirs. Measured on rendered ink, so the 1.8 stroke counts: 16.5
    // of 24 leaves better than three units of margin all round. Crop used to
    // come out 21 by 22.
    oversized: Object.entries(r.glyphs)
      .filter(([, g]) => g.width > 16.5 || g.height > 16.5)
      .map(([n, g]) => `${n} ${g.width}x${g.height}`),
    // Reported, not asserted. The redrawn set was described as cutting the
    // spread of ink from 2.8x to 1.4x; measured on what actually renders it is
    // 2.97x, against 3.05x before - barely moved. A page outline with nine
    // zigzags carries more line than a single diagonal, and no amount of
    // drawing at one weight changes that. What the set did fix is where the
    // glyphs sit and how far they reach, which is what the eye was catching.
    inkSpread: +(Math.max(...inks) / Math.min(...inks)).toFixed(2),
    lightest: Math.min(...inks),
    heaviest: Math.max(...inks),
  };

  // The tools were given outlines of their own and then lost them again: nine
  // outlines on a bar that already had two rows of boxes was more to read, not
  // less. What separates one tool from the next is a hairline.
  r.chips = await page.evaluate(() => {
    const tools = document.querySelectorAll('.tool-strip .tool-button');
    const cs = el => getComputedStyle(el);
    return {
      outline: parseFloat(cs(tools[0]).borderTopWidth),
      separator: parseFloat(cs(tools[1]).borderLeftWidth),
      // The one in hand still reads as the one in hand.
      activeFilled: cs(document.querySelector('.tool-button.active')).backgroundColor,
    };
  });

  // ---- The invariant ----
  // One control height and one icon size across the chrome, at either screen
  // size. The rows have been 46 and 44, then 48 and 43, and each time the
  // difference was invisible to a test that measured one row against itself.
  // This measures them against each other, and every icon against every other.
  const measure = () => page.evaluate(() => {
    const H = el => Math.round(el.getBoundingClientRect().height);
    const shown = sel => [...document.querySelectorAll(sel)]
      .filter(e => e.getBoundingClientRect().height > 0);
    const uniq = a => [...new Set(a)].sort((x, y) => x - y);
    return {
      // Everything a finger lands on, wherever it lives.
      controlHeights: uniq([
        ...shown('.toolbar .tb-btn'),
        ...shown('.tool-strip .tool-button'),
        ...shown('.toolbar-props .swatch, .toolbar-props .swatch-label,'
               + ' .toolbar-props .slider-box, .toolbar-props .fill-toggle,'
               + ' .toolbar-props .format-btn, .toolbar-props select'),
      ].map(H)),
      // Every glyph in the chrome, whichever bar it sits in.
      iconHeights: uniq([
        ...shown('.toolbar .btn-icon svg'),
        ...shown('.tool-strip .tool-icon svg'),
        ...shown('.float-actions .float-btn svg'),
      ].map(H)),
      // The one deliberate exception: a colour swatch is a sample of colour
      // rather than a glyph, and shrinking it to glyph size was what made a
      // dark line invisible in the first place. Bigger on purpose.
      swatchPreview: uniq(shown('.toolbar-props .swatch-preview').map(H)),
      rows: { props: H(document.querySelector('.toolbar-props')),
              strip: H(document.querySelector('.tool-strip')) },
    };
  });

  await page.evaluate(() => { document.querySelector('[data-tool="rect"]').click();
    redraw(); updateButtonStates(); });
  await page.waitForTimeout(200);
  r.atDesk = await measure();

  {
    const phone = await open({ browser, device: 'iPhone 13' });
    const desk = page;
    page = phone.page;
    await page.evaluate(() => { document.querySelector('[data-tool="rect"]').click();
      redraw(); updateButtonStates(); });
    await page.waitForTimeout(250);
    r.onPhone = await measure();
    page = desk;
  }

  r.errors = realErrors(errors);
  finish(r, {
    'set.offCentre': isEmpty,
    'set.oversized': isEmpty,
    // One height for everything you touch, one size for every glyph.
    'atDesk.controlHeights': v => Array.isArray(v) && v.length === 1,
    'atDesk.iconHeights': v => Array.isArray(v) && v.length === 1,
    'atDesk.rows.props': v => v === r.atDesk.rows.strip,
    'onPhone.controlHeights': v => Array.isArray(v) && v.length === 1,
    'onPhone.iconHeights': v => Array.isArray(v) && v.length === 1,
    'onPhone.rows.props': v => v === r.onPhone.rows.strip,
    'chips.outline': 0,
    'chips.separator': v => v >= 1,
    'chips.activeFilled': 'rgb(59, 142, 237)',
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
