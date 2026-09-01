const { open, seedPhoto, canvasBox, touch, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, atMost, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', settle: 400, resetSettle: 400 });

  const { cdp, pinch } = await touch(page, ctx);
  const r = {};

  await seedPhoto(page, { width: 2000, height: 1500, colour: '#39618c', name: 't.png' });

  const box = await canvasBox(page);

  r.startZoom = await page.evaluate(() => ({ scale: viewScale, chip: document.getElementById('zoomLevel').textContent }));

  // Pinch out with two fingers.
  await pinch({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, [40, 172], 6);

  r.afterPinch = await page.evaluate(() => ({
    scale: +viewScale.toFixed(2),
    chip: document.getElementById('floatZoom').textContent,
    chipHighlighted: !document.getElementById('floatZoom').hidden,
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
  await page.click('#floatZoom');
  await page.waitForTimeout(250);
  r.afterReset = await page.evaluate(() => ({
    scale: viewScale, chip: document.getElementById('floatZoom').textContent,
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

  // ---- Zooming a portrait photo on a laptop is continuous ----
  //
  // Between fit and fill the zoom used to be forbidden: a notch in from fit
  // jumped straight to fill and a notch back out dropped straight to fit. The
  // band skipped is the size of the aspect mismatch, which is nothing much for
  // a landscape photo on a phone - the case every zoom assertion above is
  // written against - and almost the whole useful range for a portrait photo in
  // a wide window: 100% to 291%, skipped in one notch.
  //
  // So this leg is a tall picture in a wide window, and it asserts the steps
  // rather than the endpoints. Endpoint assertions pass on a jump; only the
  // size of each step says whether the zoom is continuous.
  const desk = await open({ browser, viewport: { width: 1440, height: 900 }, settle: 400 });
  const dp = desk.page;
  await dp.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#3d6b8f'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; imgOffset = { x: 0, y: 0 }; canvasOverride = null; resizeCanvas();
  });
  await dp.waitForTimeout(400);

  r.portraitZoom = await dp.evaluate(() => {
    resetZoom();
    // The scale at which the picture would cover the frame edge to edge. The
    // app no longer computes this - the band is not special to it any more - so
    // the suite works it out itself to say where the band was.
    const cont = document.querySelector('.canvas-container');
    const fill = Math.max(cont.clientWidth / canvas.offsetWidth,
                          cont.clientHeight / canvas.offsetHeight);
    const cv = canvas.getBoundingClientRect();
    const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    const notch = dy => canvas.dispatchEvent(new WheelEvent('wheel',
      { deltaY: dy, clientX: cx, clientY: cy, ctrlKey: true, bubbles: true, cancelable: true }));

    // Largest step over smallest: 1 when every notch moves the same proportion.
    const spread = rs => Math.max(...rs) / Math.min(...rs);

    const stepsIn = [];
    for (let i = 0; i < 6; i++) { notch(-100); stepsIn.push(viewScale); }
    const stepsOut = [];
    for (let i = 0; i < 6; i++) { notch(100); stepsOut.push(viewScale); }

    // The ratio each notch multiplied the scale by. Smoothness is these being
    // all the same, not any of them being small: the snap showed up as one step
    // of 2.3 among steps of 1.18. Asserting a cap instead would pin the step
    // size, so retuning how far a notch goes would fail a test about jumps.
    const ratios = (seq, from) => seq.map((v, i) => {
      const prev = i === 0 ? from : seq[i - 1];
      return Math.max(v / prev, prev / v);
    });

    return {
      fill: +fill.toFixed(3),
      stepsIn: stepsIn.map(v => +v.toFixed(3)),
      stepsOut: stepsOut.map(v => +v.toFixed(3)),
      stepSpreadIn: +spread(ratios(stepsIn, 1)).toFixed(3),
      // Not trimmed at the fit end: zooming out retraces the same scales, so
      // the last step is a whole notch like the rest. Dropping it as a partial
      // one hid the snap, which landed on exactly that step.
      stepSpreadOut: +spread(ratios(stepsOut, stepsIn[stepsIn.length - 1])).toFixed(3),
      notchSize: +ratios(stepsIn, 1)[1].toFixed(3),
      // A run that hit the ceiling would report a short step as unevenness, so
      // the suite says plainly that it did not.
      clampedAtMax: stepsIn.some(v => v >= MAX_ZOOM - 0.001),
      // The band between fit and fill has to be somewhere you can actually stop.
      restsInsideTheBand: stepsIn.some(v => v > 1.02 && v < fill * 0.98),
    };
  });
  await desk.context.close();

  r.errors = realErrors(errors);
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
    // Without a wide mismatch this leg proves nothing.
    'portraitZoom.fill': atLeast(2),
    // Every notch the same proportion, in and out. This is what smooth means.
    'portraitZoom.stepSpreadIn': near(1, 0.02),
    'portraitZoom.stepSpreadOut': near(1, 0.02),
    // How far a notch goes is a matter of taste and gets retuned; that it stays
    // inside arm's reach of a notch is not.
    'portraitZoom.notchSize': v => typeof v === 'number' && v > 1.05 && v < 1.8,
    // If a retune ever makes six notches reach the ceiling, use fewer notches
    // here rather than loosening the spread.
    'portraitZoom.clampedAtMax': isFalse,
    'portraitZoom.restsInsideTheBand': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
