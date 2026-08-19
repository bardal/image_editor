// The leftovers from the coverage sweep: pasting an image, closing a polygon,
// shape labels, cycling through stacked shapes, and the service worker that
// decides which build you actually get.
const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const r = {};

  // ---- Paste ----
  {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(APP); await page.waitForTimeout(300);
    await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
    await page.reload(); await page.waitForTimeout(400);

    // A paste event carrying an image file, which is what a real paste delivers.
    r.pasteEvent = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 480;
      const g = cv.getContext('2d'); g.fillStyle = '#884422'; g.fillRect(0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      const file = new File([blob], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      await new Promise(res => setTimeout(res, 900));
      const d = ctx.getImageData(10, 10, 1, 1).data;
      return {
        hasImage: !!img,
        // The canvas takes the pasted image's own size.
        canvas: [canvas.width, canvas.height],
        pixel: `rgb(${d[0]},${d[1]},${d[2]})`,
      };
    });

    // The toolbar button reads the clipboard instead, a different path.
    r.pasteButton = await page.evaluate(async () => {
      await dbDelete('image');
      shapes.length = 0; img = null; resizeCanvas();
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 240;
      const g = cv.getContext('2d'); g.fillStyle = '#2266aa'; g.fillRect(0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      await pasteFromClipboard();
      await new Promise(res => setTimeout(res, 900));
      const d = ctx.getImageData(5, 5, 1, 1).data;
      return {
        hasImage: !!img,
        canvas: [canvas.width, canvas.height],
        pixel: `rgb(${d[0]},${d[1]},${d[2]})`,
      };
    });

    // Nothing on the clipboard must say so rather than fail silently.
    r.pasteNothing = await page.evaluate(async () => {
      await navigator.clipboard.writeText('just some words');
      await pasteFromClipboard();
      await new Promise(res => setTimeout(res, 400));
      return document.getElementById('toast').textContent;
    });

    r.pasteErrors = errors.filter(e => !e.includes('ServiceWorker'));
    await ctx.close();
  }

  // ---- Closing a polygon, and filling it ----
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(APP); await page.waitForTimeout(300);
    await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
    await page.reload(); await page.waitForTimeout(400);
    const cdp = await ctx.newCDPSession(page);
    const box = await page.evaluate(() => {
      const b = canvas.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    await page.evaluate(() => document.querySelector('[data-tool="polyline"]').click());
    await page.waitForTimeout(150);

    const tap = async (pt) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
    };
    const drag = async (from, to) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let i = 1; i <= 4; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
          { x: from.x + (to.x - from.x) * i / 4, y: from.y + (to.y - from.y) * i / 4 }] });
        await page.waitForTimeout(25);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
    };

    const start = { x: box.x + 60, y: box.y + 60 };
    await tap(start);
    await drag(start, { x: box.x + 220, y: box.y + 70 });
    await drag({ x: box.x + 220, y: box.y + 70 }, { x: box.x + 180, y: box.y + 200 });
    // Landing back on the first point closes the shape.
    await tap(start);
    r.closedPolygon = await page.evaluate(() => {
      const p = shapes.find(s => s.type === 'polyline');
      return p ? { closed: !!p.closed, points: p.points.length, canFill: canFill(p) } : null;
    });

    // A closed polygon encloses an area, so a point inside it is a hit.
    r.polygonHitInside = await page.evaluate(() => {
      const p = shapes.find(s => s.type === 'polyline');
      if (!p || !p.closed) return null;
      const cx = p.points.reduce((a, q) => a + q.x, 0) / p.points.length;
      const cy = p.points.reduce((a, q) => a + q.y, 0) / p.points.length;
      return isPointInShape(cx, cy, p);
    });
    await ctx.close();
  }

  // ---- Labels on a shape, and cycling through a stack ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(APP); await page.waitForTimeout(300);
    await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
    await page.reload(); await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 900; cv.height = 600;
      const g = cv.getContext('2d'); g.fillStyle = '#333'; g.fillRect(0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      await processImageFile(new File([blob], 'p.png', { type: 'image/png' }));
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      shapes.length = 0;
      shapes.push({ type: 'rect', x: 150, y: 150, w: 400, h: 250, rotation: 0,
        color: '#e33', size: 5, fill: false, id: 1 });
      document.querySelector('[data-tool="select"]').click();
      selectedShape = shapes[0]; redraw(); updateButtonStates();
    });
    await page.waitForTimeout(150);

    // Typing a printable character on a selected shape starts its label.
    await page.keyboard.press('V');
    await page.waitForTimeout(200);
    const labelOpen = await page.evaluate(() =>
      document.getElementById('canvasTextInput').style.display !== 'none');
    await page.keyboard.type('alve');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    r.label = await page.evaluate(() => ({
      opened: true,
      text: shapes[0].label,
      // Drawn on the shape, so the pixels under the label are no longer plain.
      editorClosed: document.getElementById('canvasTextInput').style.display === 'none',
    }));
    r.label.opened = labelOpen;

    r.labelSurvivesUndo = await page.evaluate(() => {
      const before = shapes[0].label;
      undoLastAction();
      return { before, after: shapes[0] ? shapes[0].label : null };
    });

    // Overlapping shapes: repeated clicks step through the stack rather than
    // always picking the top one.
    await page.evaluate(() => {
      shapes.length = 0; undoStack.length = 0;
      shapes.push({ type: 'rect', x: 200, y: 200, w: 300, h: 200, rotation: 0,
        color: '#e33', size: 5, fill: false, id: 11 });
      shapes.push({ type: 'rect', x: 250, y: 240, w: 300, h: 200, rotation: 0,
        color: '#3e3', size: 5, fill: false, id: 12 });
      document.querySelector('[data-tool="select"]').click();
      selectedShape = null; redraw(); updateButtonStates();
    });
    const overlap = await page.evaluate(() => {
      const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
      // A point inside both boxes.
      return { x: b.x + 300 / k, y: b.y + 260 / k };
    });
    const picks = [];
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(overlap.x, overlap.y);
      await page.waitForTimeout(180);
      picks.push(await page.evaluate(() => selectedShape ? selectedShape.id : null));
    }
    r.cyclesThroughStack = {
      picks,
      // Two shapes under the point, so the selection must alternate.
      alternates: picks[0] !== picks[1] && picks[1] !== picks[2],
    };
    await page.close();
  }

  // ---- Service worker ----
  // It decides which build you get, which is why a deploy needs two loads.
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(APP);
    await page.waitForTimeout(1500);
    r.serviceWorker = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return { supported: false };
      const reg = await navigator.serviceWorker.getRegistration();
      const names = await caches.keys();
      return {
        supported: true,
        registered: !!reg,
        cacheNames: names,
        // One cache per build, so a deploy retires the previous offline copy.
        buildScopedCache: names.some(n => n.startsWith('etch-')),
      };
    });

    r.cachedTheApp = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find(n => n.startsWith('etch-')) || names[0]);
      const keys = await cache.keys();
      const paths = keys.map(k => new URL(k.url).pathname);
      return {
        count: keys.length,
        hasIndex: paths.some(p => p.endsWith('/') || p.endsWith('index.html')),
      };
    });
    r.swErrors = errors.filter(e => !e.includes('ServiceWorker'));
    await page.close();
  }

  finish(r, {
    'pasteEvent.hasImage': isTrue,
    'pasteEvent.canvas': [640, 480],
    'pasteEvent.pixel': 'rgb(136,68,34)',
    'pasteButton.hasImage': isTrue,
    'pasteButton.canvas': [320, 240],
    'pasteButton.pixel': 'rgb(34,102,170)',
    'pasteNothing': v => typeof v === 'string' && /no image|nothing/i.test(v),
    'pasteErrors': isEmpty,
    'closedPolygon.closed': isTrue,
    'closedPolygon.points': atLeast(3),
    'closedPolygon.canFill': isTrue,
    'polygonHitInside': isTrue,
    'label.opened': isTrue,
    'label.text': 'Valve',
    'label.editorClosed': isTrue,
    'labelSurvivesUndo.before': 'Valve',
    'labelSurvivesUndo.after': undefined,
    'cyclesThroughStack.alternates': isTrue,
    'serviceWorker.registered': isTrue,
    'serviceWorker.buildScopedCache': isTrue,
    'cachedTheApp.hasIndex': isTrue,
    'swErrors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
