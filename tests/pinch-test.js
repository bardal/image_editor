// Two faults reported from a phone: pinching to zoom slides the picture around
// instead of keeping the spot between your fingers still, and once zoomed the
// drawing goes soft and pale rather than getting crisper.
const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser').path() });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload();
  await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);
  const r = {};

  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  // Which point of the drawing sits under a given place on the glass.
  const contentUnder = (clientX, clientY) => page.evaluate(([x, y]) => {
    const p = screenToCanvas(x, y);
    return { x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
  }, [clientX, clientY]);

  // Pinch about a point, in steps, the way fingers actually move: one finger
  // lands, then the second. Sending both in a single touchStart only registers
  // one of them on any gesture after the first, and the pinch never begins.
  // Fingers land, travel through a list of spreads, and lift. Passing several
  // spreads exercises one continuous gesture - out and back in without lifting -
  // which is where an error that accumulates between frames would show.
  let nextTouchId = 1;
  const pinchThrough = async (cx, cy, spreads, steps = 8) => {
    const a = nextTouchId++, b = nextTouchId++;
    const at = (spread) => [
      { x: cx - spread, y: cy, id: a }, { x: cx + spread, y: cy, id: b }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(spreads[0]) });
    for (let leg = 1; leg < spreads.length; leg++) {
      const from = spreads[leg - 1], to = spreads[leg];
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: at(from + (to - from) * (i / steps)) });
        await page.waitForTimeout(30);
      }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  };
  const pinchAbout = (cx, cy, from, to, steps = 8) => pinchThrough(cx, cy, [from, to], steps);

  // ---- The spot between the fingers must not move ----
  // Off-centre on purpose: an error in the anchor maths cancels out in the
  // middle of the canvas and only shows up away from it.
  const anchorX = box.x + box.w * 0.3;
  const anchorY = box.y + box.h * 0.35;
  const before = await contentUnder(anchorX, anchorY);
  await pinchAbout(anchorX, anchorY, 40, 150);
  const after = await contentUnder(anchorX, anchorY);
  r.anchorHolds = {
    scale: await page.evaluate(() => +viewScale.toFixed(2)),
    before, after,
    driftX: +Math.abs(after.x - before.x).toFixed(1),
    driftY: +Math.abs(after.y - before.y).toFixed(1),
  };

  // Same again nearer a corner, where the clamp has most to say.
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);
  const cornerX = box.x + box.w * 0.8;
  const cornerY = box.y + box.h * 0.75;
  const cornerBefore = await contentUnder(cornerX, cornerY);
  await pinchAbout(cornerX, cornerY, 40, 130);
  const cornerAfter = await contentUnder(cornerX, cornerY);
  r.anchorHoldsNearCorner = {
    scale: await page.evaluate(() => +viewScale.toFixed(2)),
    driftX: +Math.abs(cornerAfter.x - cornerBefore.x).toFixed(1),
    driftY: +Math.abs(cornerAfter.y - cornerBefore.y).toFixed(1),
  };

  // Out and back in, without lifting: it must land where it started rather than
  // creeping a little further each frame.
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);
  const roundTripBefore = await contentUnder(anchorX, anchorY);
  await pinchThrough(anchorX, anchorY, [40, 150, 40]);
  const roundTripAfter = await contentUnder(anchorX, anchorY);
  r.roundTrip = {
    scale: await page.evaluate(() => +viewScale.toFixed(2)),
    driftX: +Math.abs(roundTripAfter.x - roundTripBefore.x).toFixed(1),
    driftY: +Math.abs(roundTripAfter.y - roundTripBefore.y).toFixed(1),
  };

  // ---- Sharpness ----
  // With no photo loaded the canvas is sized to the container, so it holds one
  // bitmap pixel per CSS pixel. The phone's screen is 3 of those to a CSS pixel,
  // and zooming stretches the same bitmap further still: the drawing is being
  // enlarged rather than redrawn, which is why it goes soft and pale.
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);
  r.deviceRatio = await page.evaluate(() => window.devicePixelRatio);

  const bitmapPerCssPixel = () => page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return +(canvas.width / b.width).toFixed(2);
  });

  r.sharpnessBlank = { atFit: await bitmapPerCssPixel() };
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 100,
                                      canvas.getBoundingClientRect().top + 100));
  await page.waitForTimeout(250);
  r.sharpnessBlank.at4x = await bitmapPerCssPixel();
  r.sharpnessBlank.zoom = await page.evaluate(() => +viewScale.toFixed(2));

  // A stroke must still get thicker on screen as you zoom in.
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);
  r.strokeOnScreen = await page.evaluate(() => {
    const measure = () => {
      const b = canvas.getBoundingClientRect();
      return +(strokeWidth(4) * (b.width / canvas.width)).toFixed(2);
    };
    const atFit = measure();
    setZoom(4, b0(), b1());
    function b0() { return canvas.getBoundingClientRect().left + 50; }
    function b1() { return canvas.getBoundingClientRect().top + 50; }
    const at4x = measure();
    resetZoom();
    return { atFit, at4x, thicker: at4x > atFit * 3 };
  });

  // With a photo loaded the bitmap is far larger than the screen, so zooming in
  // reveals detail. That case must not regress either.
  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 2400; cv.height = 1800;
    const g = cv.getContext('2d'); g.fillStyle = '#39618c'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(700);
  r.sharpnessPhoto = { atFit: await bitmapPerCssPixel() };
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 100,
                                      canvas.getBoundingClientRect().top + 100));
  await page.waitForTimeout(250);
  r.sharpnessPhoto.at4x = await bitmapPerCssPixel();
  await page.evaluate(() => resetZoom());

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    // A couple of canvas units of slack for rounding; anything more is a slide.
    'anchorHolds.scale': atLeast(2),
    'anchorHolds.driftX': v => v <= 2,
    'anchorHolds.driftY': v => v <= 2,
    'anchorHoldsNearCorner.scale': atLeast(2),
    'anchorHoldsNearCorner.driftX': v => v <= 2,
    'anchorHoldsNearCorner.driftY': v => v <= 2,
    'roundTrip.scale': 1,
    'roundTrip.driftX': v => v <= 2,
    'roundTrip.driftY': v => v <= 2,
    // Never fewer bitmap pixels than the screen has, at any zoom.
    'sharpnessBlank.atFit': v => v >= 1,
    'sharpnessBlank.at4x': v => v >= 1,
    'sharpnessPhoto.atFit': v => v >= 1,
    'sharpnessPhoto.at4x': v => v >= 1,
    'strokeOnScreen.thicker': isTrue,
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
