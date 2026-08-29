const { open, seedPhoto } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', settle: 400, resetSettle: 400 });

  const cdp = await ctx.newCDPSession(page);
  const r = {};

  await seedPhoto(page, { width: 2000, height: 1500, colour: '#39618c', name: 't.png' });

  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  r.startZoom = await page.evaluate(() => ({ scale: viewScale, chip: document.getElementById('zoomLevel').textContent }));

  // Pinch out with two fingers.
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
    touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
  for (let i = 1; i <= 6; i++) {
    const spread = 40 + i * 22;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x: cx - spread, y: cy, id: 1 }, { x: cx + spread, y: cy, id: 2 }] });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);

  r.afterPinch = await page.evaluate(() => ({
    scale: +viewScale.toFixed(2),
    chip: document.getElementById('zoomLevel').textContent,
    chipHighlighted: document.getElementById('zoomLevel').classList.contains('zoomed'),
    transformed: canvas.style.transform !== '',
  }));
  r.noStrayShape = await page.evaluate(() => shapes.length === 0);

  // Stroke must stay fixed on the image as zoom changes, with a floor.
  r.strokeAcrossZoom = await page.evaluate(() => {
    const at = z => { const prev = viewScale; viewScale = z; applyView();
                      const v = +strokeWidth(3).toFixed(2); viewScale = prev; applyView(); return v; };
    return { atFit: at(1), at4x: at(4) };
  });

  // Reset via the status bar chip.
  await page.click('#zoomLevel');
  await page.waitForTimeout(250);
  r.afterReset = await page.evaluate(() => ({
    scale: viewScale, chip: document.getElementById('zoomLevel').textContent,
    transform: canvas.style.transform,
  }));

  // One finger must still draw, not pan.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 60, y: box.y + 60 }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 60 + i * 25, y: box.y + 60 + i * 18 }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  r.oneFingerStillDraws = await page.evaluate(() => ({ shapes: shapes.length, zoomUnchanged: viewScale === 1 }));

  // Drawing while zoomed must land where the finger is.
  await page.evaluate(() => { shapes.length = 0; setZoom(3, canvas.getBoundingClientRect().left + 50, canvas.getBoundingClientRect().top + 50); });
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 120, y: box.y + 150 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 200, y: box.y + 220 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  r.drawWhileZoomed = await page.evaluate(() => {
    if (!shapes.length) return null;
    const s = shapes[0];
    const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    // Where the shape's origin lands back on screen.
    return { screenX: Math.round(b.left + s.x / k), screenY: Math.round(b.top + s.y / k) };
  });
  r.expectedTouchPoint = { x: Math.round(box.x + 120), y: Math.round(box.y + 150) };

  // ---- An arrowhead has to keep its proportion to its own line ----
  // The head was sized in screen pixels while the line it caps was sized
  // against the image, so the two moved opposite ways: zoom in and the line
  // thickened while the head stayed put, until the head was narrower than the
  // line and vanished into it.
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    shapes.length = 0;
    selectedShape = null;
    // Horizontal, so a vertical scan measures thickness directly.
    shapes.push({ type: 'arrow', x: canvas.width * 0.2, y: canvas.height * 0.5,
      x2: canvas.width * 0.8, y2: canvas.height * 0.5, color: '#ff0000', size: 5,
      startStyle: 'none', endStyle: 'closedArrow', id: 900 });
    redraw();
  });
  await page.waitForTimeout(200);

  // Paint thickness down a column, in canvas pixels.
  const headVsLine = () => page.evaluate(() => {
    const a = shapes[0];
    const y0 = Math.round(a.y);
    const column = (x) => {
      const top = Math.max(0, y0 - 400);
      const col = ctx.getImageData(Math.round(x), top, 1,
        Math.min(800, canvas.height - top)).data;
      // Counts the arrow's own red, not opacity: the photo behind it is opaque
      // everywhere, so an alpha test reads the whole column as painted.
      let n = 0;
      for (let i = 0; i < col.length; i += 4) {
        if (col[i] > 150 && col[i + 1] < 100 && col[i + 2] < 100) n++;
      }
      return n;
    };
    // The shaft, well clear of either end.
    const line = column(a.x + (a.x2 - a.x) * 0.5);
    // The head, sampled just behind the tip where it is at its widest.
    let head = 0;
    for (let d = 2; d < 60; d++) head = Math.max(head, column(a.x2 - d));
    return { line, head, ratio: line ? +(head / line).toFixed(2) : 0 };
  });

  const headAtFit = await headVsLine();
  await page.evaluate(() => {
    setZoom(4, canvas.getBoundingClientRect().left + 20,
               canvas.getBoundingClientRect().top + 20);
    redraw();
  });
  await page.waitForTimeout(250);
  const headAt4x = await headVsLine();
  await page.evaluate(() => resetZoom());
  r.arrowhead = {
    atFit: headAtFit,
    at4x: headAt4x,
    // Same shape at any zoom: the head keeps its proportion to its own line.
    ratioHeld: Math.abs(headAtFit.ratio - headAt4x.ratio) < 0.35,
  };

  // The shaft ran all the way to the arrowhead's point. Near the point the
  // triangle is narrower than the shaft, so the shaft's flat end stuck out on
  // both sides as a square nub - obvious once the line is thick.
  r.tipIsPointed = await page.evaluate(() => {
    const a = shapes[0];
    const y0 = Math.round(a.y);
    const column = (x) => {
      const top = Math.max(0, y0 - 400);
      const col = ctx.getImageData(Math.round(x), top, 1,
        Math.min(800, canvas.height - top)).data;
      let n = 0;
      for (let i = 0; i < col.length; i += 4) {
        if (col[i] > 150 && col[i + 1] < 100 && col[i + 2] < 100) n++;
      }
      return n;
    };
    const shaft = column(a.x + (a.x2 - a.x) * 0.5);
    // A hair behind the point the arrowhead has barely any width, so anything
    // like the shaft's thickness here is the nub.
    const atPoint = column(a.x2 - 2);
    return { shaft, atPoint, pointed: atPoint < shaft * 0.6 };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'startZoom.scale': 1,
    'startZoom.chip': '100%',
    'afterPinch.scale': atLeast(2),
    'afterPinch.chipHighlighted': isTrue,
    'afterPinch.transformed': isTrue,
    'noStrayShape': isTrue,
    // Stroke width is fixed to the image, so zooming does not fatten a line.
    'strokeAcrossZoom': v => v && Math.abs(v.atFit - v.at4x) < 0.01,
    'afterReset.scale': 1,
    'afterReset.chip': '100%',
    'afterReset.transform': '',
    'oneFingerStillDraws.shapes': 1,
    'oneFingerStillDraws.zoomUnchanged': isTrue,
    // Drawn while zoomed in, the shape must land back under the finger.
    'drawWhileZoomed.screenX': near(r.expectedTouchPoint.x, 2),
    'drawWhileZoomed.screenY': near(r.expectedTouchPoint.y, 2),
    // The head must be plainly wider than the line it caps, or it is invisible.
    'arrowhead.atFit.ratio': v => v >= 2,
    'arrowhead.at4x.ratio': v => v >= 2,
    'arrowhead.ratioHeld': isTrue,
    'tipIsPointed.pointed': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
