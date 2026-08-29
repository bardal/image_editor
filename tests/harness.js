// The things every suite does, in one place.
//
// Twenty-seven suites each opened a browser, wiped the stored document,
// reloaded, built a synthetic photo and hand-rolled the same touch gestures.
// The seeding block in particular had thirteen copies, and one of them - in
// clear-test - was quietly broken for a while: it returned page.evaluate
// without calling it, so every "image" case in that suite ran with no image
// and passed anyway. Thirteen copies is thirteen places for that to happen.
//
// Suites keep their own setup where it is theirs: what they draw, what they
// tap, what they assert. This covers the part that is the same everywhere.
const { chromium, devices } = require('playwright');

const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

// Wipes what the app has stored and reloads, so a suite starts from nothing
// rather than from whatever the last one left in IndexedDB.
async function resetApp(page, settle = 500) {
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload();
  await page.waitForTimeout(settle);
}

// Some suites want several pages from one browser - a phone context and a
// desktop one, say - so a browser can be passed in and reused. Whoever launched
// it closes it.
async function launch() {
  return chromium.launch({ executablePath: require('./browser').path() });
}

// Opens the app. `device` takes a Playwright device name for the phone suites,
// `viewport` a size for the desktop ones; `reset` is on unless a suite is
// specifically testing what survives a reload.
async function open({ browser: given, device, viewport, permissions, downloads,
                      reset = true, settle = 300 } = {}) {
  const browser = given || await launch();
  const options = {};
  if (device) Object.assign(options, devices[device]);
  if (viewport) options.viewport = viewport;
  if (downloads) options.acceptDownloads = true;
  const context = await browser.newContext(options);
  if (permissions) await context.grantPermissions(permissions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(settle);
  if (reset) await resetApp(page);
  return { browser, context, page, errors };
}

// A flat colour of a known size, loaded the way a real file is. Flat because a
// sampled pixel then means something: a photo with detail in it cannot tell
// you whether what you sampled is the drawing or the picture.
async function seedPhoto(page, { width = 800, height = 500, colour = '#3d6b8f',
                                 name = 'photo.png', settle = 600 } = {}) {
  await page.evaluate(async ({ width, height, colour, name }) => {
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const g = cv.getContext('2d');
    g.fillStyle = colour; g.fillRect(0, 0, width, height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], name, { type: 'image/png' }));
  }, { width, height, colour, name });
  await page.waitForTimeout(settle);
}

// Where the canvas is on screen, and a point inside it by fraction. Measured
// when asked rather than held: the property bar takes a different number of
// rows for different tools, so the canvas moves as tools change.
async function canvasBox(page) {
  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  box.at = (fx, fy) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });
  return box;
}

// Touch, through CDP: a real finger, not a synthesised mouse. Several faults
// here have only ever appeared on one of the two.
async function touch(page, context) {
  const cdp = await context.newCDPSession(page);
  const send = (type, touchPoints) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

  // The timings are options because they are load-bearing: a hold before the
  // move is what tells a long press from a drag, and how long a suite waits
  // after the lift is how long the app has to finish what the gesture started.
  // Suites that were written around particular numbers keep them.
  const tap = async (pt, { hold = 60, settle = 200 } = {}) => {
    await send('touchStart', [pt]);
    if (hold) await page.waitForTimeout(hold);
    await send('touchEnd', []);
    await page.waitForTimeout(settle);
  };

  const drag = async (from, to, { steps = 5, pause = 20, hold = 0, settle = 200 } = {}) => {
    await send('touchStart', [from]);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', [{ x: from.x + (to.x - from.x) * i / steps,
                                 y: from.y + (to.y - from.y) * i / steps }]);
      await page.waitForTimeout(pause);
    }
    await send('touchEnd', []);
    await page.waitForTimeout(settle);
  };

  // Both fingers land together and travel through a list of spreads, so one
  // gesture can go out and back without lifting. The ids matter: a second
  // pinch that reuses the ids of the first only registers one finger and never
  // begins, so every gesture gets a fresh pair.
  let nextId = 1;
  const pinch = async (centre, spreads, steps = 8) => {
    const a = nextId++, b = nextId++;
    const at = s => [{ x: centre.x - s, y: centre.y, id: a },
                     { x: centre.x + s, y: centre.y, id: b }];
    await send('touchStart', at(spreads[0]));
    for (let leg = 1; leg < spreads.length; leg++) {
      const from = spreads[leg - 1], to = spreads[leg];
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', at(from + (to - from) * (i / steps)));
        await page.waitForTimeout(30);
      }
    }
    await send('touchEnd', []);
    await page.waitForTimeout(200);
  };

  return { cdp, send, tap, drag, pinch };
}

// The service worker announces itself on every load; it is not a page fault.
const realErrors = errors => errors.filter(e => !e.includes('ServiceWorker'));

module.exports = { APP, launch, open, resetApp, seedPhoto, canvasBox, touch, realErrors };
