const { open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', reset: false });

  const r = {};

  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);

  // The decisive check: focus must already be on the input by the time the
  // pointerdown handler returns. iOS only opens the keyboard when focus lands
  // inside the gesture; anything deferred leaves the keyboard shut.
  r.focusedSynchronouslyInGesture = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    const ev = new PointerEvent('pointerdown', {
      clientX: b.x + b.width / 2, clientY: b.y + b.height / 2,
      isPrimary: true, pointerType: 'touch', bubbles: true, cancelable: true,
    });
    canvas.dispatchEvent(ev);
    // Read activeElement immediately - no await, no timer.
    return document.activeElement === document.getElementById('calloutTextInput');
  });

  r.inputVisible = await page.evaluate(() =>
    document.getElementById('calloutTextInput').style.display === 'block');

  // Typing must reach the input and commit as a shape.
  await page.keyboard.type('Hello phone');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(200);
  r.textShape = await page.evaluate(() => {
    const t = shapes.find(s => s.type === 'text');
    return t ? t.text : null;
  });

  // Status bar: build chip must be visible and the bar must not overflow.
  r.statusBar = await page.evaluate(() => {
    const chip = document.getElementById('aboutBtn');
    const c = chip.getBoundingClientRect();
    const sb = document.querySelector('.status-bar');
    return {
      chipVisible: c.width > 0 && c.right <= window.innerWidth + 1,
      chipWidth: Math.round(c.width),
      barHeight: Math.round(sb.getBoundingClientRect().height),
      hintHidden: getComputedStyle(document.querySelector('.heic-info')).display === 'none',
    };
  });

  r.pageErrors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    // iOS only raises the keyboard when focus lands inside the gesture.
    'focusedSynchronouslyInGesture': isTrue,
    'inputVisible': isTrue,
    'textShape': 'Hello phone',
    'statusBar.chipVisible': isTrue,
    'statusBar.hintHidden': isTrue,
  });

  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'mobile-menu.png' });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
