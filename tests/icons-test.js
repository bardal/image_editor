// The nine tool glyphs were drawn one at a time rather than as a set: nine
// sizes on the same 24-unit grid. Crop covered 2.8x the ink of Select and was
// the only glyph touching its box edges; Tear centred on 10.5 where every
// other centres on 12, so it rode about a pixel high in a button that measured
// perfectly square. Nothing about the buttons was wrong, which is why no test
// of the buttons ever caught it.
//
// This measures the drawings themselves: each symbol is rendered on its own at
// four times size, and the ink it leaves is weighed and located.
const { open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1200, height: 800 }, reset: false });

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

  // The strip they sit in has an edge of its own, and each tool is a chip
  // inside it rather than a glyph floating on the bar.
  r.chips = await page.evaluate(() => {
    const btn = document.querySelector('.tool-strip .tool-button');
    const cs = getComputedStyle(btn);
    return {
      borderWidth: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      // The one in hand still reads as the one in hand.
      activeFilled: getComputedStyle(document.querySelector('.tool-button.active'))
        .backgroundColor,
    };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'set.offCentre': isEmpty,
    'set.oversized': isEmpty,
    'chips.borderWidth': v => parseFloat(v) >= 1,
    'chips.radius': v => parseFloat(v) >= 4,
    'chips.activeFilled': 'rgb(59, 142, 237)',
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
