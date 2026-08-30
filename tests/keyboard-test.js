const { open, realErrors } = require('./harness');
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
    // The status bar is a desk thing now - an image size, a pointer position
    // with no pointer, and a build number - so what it carried has to be
    // reachable elsewhere: About from the top bar, zoom from the picture.
    const about = document.getElementById('aboutTop').getBoundingClientRect();
    const sb = document.querySelector('.status-bar');
    return {
      statusBarHidden: getComputedStyle(sb).display === 'none',
      aboutReachable: about.width > 0 && about.right <= window.innerWidth + 1
                      && about.height >= 43.5,
      zoomOnPicture: !!document.getElementById('floatZoom'),
    };
  });

  r.pageErrors = realErrors(errors);
  finish(r, {
    // iOS only raises the keyboard when focus lands inside the gesture.
    'focusedSynchronouslyInGesture': isTrue,
    'inputVisible': isTrue,
    'textShape': 'Hello phone',
    'statusBar.statusBarHidden': isTrue,
    'statusBar.aboutReachable': isTrue,
    'statusBar.zoomOnPicture': isTrue,
  });

  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'mobile-menu.png' });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
