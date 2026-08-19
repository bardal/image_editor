const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(300);

  const check = async (tool) => {
    await page.evaluate(t => document.querySelector(`[data-tool="${t}"]`).click(), tool);
    await page.waitForTimeout(180);
    return page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const props = document.querySelector('.toolbar-props');
      const strip = document.querySelector('.tool-strip');
      const canvasEl = document.getElementById('canvas');
      const pr = props.getBoundingClientRect();
      const sr = strip.getBoundingClientRect();
      const cr = canvasEl.getBoundingClientRect();

      // Every control must sit inside the property bar's scrollable extent,
      // i.e. reachable by scrolling even if not currently visible.
      const unreachable = [];
      // And every one must be on screen as it stands. A control parked off the
      // edge behind a horizontal scroll is a control nobody finds: the fill
      // swatch sat 654px along a 390px screen, so "how do I apply fill colour?"
      // had no answer on the phone.
      const offScreen = [];
      props.querySelectorAll('button, input, select, label').forEach(el => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        const offsetLeft = el.offsetLeft;
        if (offsetLeft < 0 || offsetLeft + el.offsetWidth > props.scrollWidth + 2) {
          unreachable.push(el.id || el.className);
        }
        if (b.left < -1 || b.right > vw + 1) offScreen.push(el.id || el.className);
      });

      // All six tools must be visible without scrolling.
      const toolsVisible = [...strip.querySelectorAll('.tool-button')]
        .every(b => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= vw + 1; });

      return {
        viewport: [vw, vh],
        toolStripPinnedBottom: Math.abs(sr.bottom - vh) <= 1,
        propsShown: pr.height > 0,
        propsAboveStrip: pr.height === 0 || Math.abs(pr.bottom - sr.top) <= 1,
        toolsAllVisible: toolsVisible,
        toolCount: strip.querySelectorAll('.tool-button').length,
        propsScrollWidth: props.scrollWidth,
        propsWidth: Math.round(pr.width),
        // Nothing hidden sideways: the bar takes another row instead.
        needsSideScroll: props.scrollWidth > props.clientWidth + 1,
        unreachableInProps: unreachable,
        offScreenInProps: offScreen,
        // Compare against whichever pinned bar is topmost: the property bar
        // hides itself when nothing in it applies, leaving the tool strip.
        canvasClearOfBars: cr.bottom <= (pr.height > 0 ? pr.top : sr.top) + 1,
        chromeTotalPx: Math.round(document.querySelector('.toolbar').getBoundingClientRect().height + pr.height + sr.height),
        chromePercent: Math.round((document.querySelector('.toolbar').getBoundingClientRect().height + pr.height + sr.height) / vh * 100),
      };
    });
  };

  const byTool = {};
  for (const t of ['select', 'rect', 'text', 'arrow', 'callout', 'crop']) {
    byTool[t] = await check(t);
  }

  // The two controls the question was actually about, under every tool that
  // offers them: both colour swatches, fully on screen, no scrolling.
  const swatches = {};
  for (const t of ['rect', 'ellipse', 'callout']) {
    await page.evaluate(x => document.querySelector(`[data-tool="${x}"]`).click(), t);
    await page.waitForTimeout(180);
    swatches[t] = await page.evaluate(() => {
      const on = id => {
        const el = document.getElementById(id);
        const b = el.getBoundingClientRect();
        if (!b.width) return null;
        return b.left >= -1 && b.right <= window.innerWidth + 1
            && b.top >= -1 && b.bottom <= window.innerHeight + 1;
      };
      return { stroke: on('strokeSwatch'), fill: on('fillSwatch') };
    });
  }

  finish({
    byTool, swatches,
    errors: errors.filter(e => !e.includes('ServiceWorker')),
  }, {
    'byTool.select.toolStripPinnedBottom': isTrue,
    'byTool.rect.offScreenInProps': isEmpty,
    'byTool.rect.needsSideScroll': isFalse,
    'byTool.select.offScreenInProps': isEmpty,
    'byTool.text.offScreenInProps': isEmpty,
    'byTool.text.needsSideScroll': isFalse,
    'byTool.arrow.offScreenInProps': isEmpty,
    'byTool.arrow.needsSideScroll': isFalse,
    'byTool.callout.offScreenInProps': isEmpty,
    'byTool.callout.needsSideScroll': isFalse,
    'byTool.callout.canvasClearOfBars': isTrue,
    'byTool.crop.offScreenInProps': isEmpty,
    'byTool.crop.needsSideScroll': isFalse,
    'swatches.rect.stroke': isTrue,
    'swatches.rect.fill': isTrue,
    'swatches.ellipse.stroke': isTrue,
    'swatches.ellipse.fill': isTrue,
    'swatches.callout.stroke': isTrue,
    'swatches.callout.fill': isTrue,
    'byTool.select.toolsAllVisible': isTrue,
    'byTool.select.unreachableInProps': isEmpty,
    'byTool.select.canvasClearOfBars': isTrue,
    'byTool.text.toolStripPinnedBottom': isTrue,
    'byTool.text.propsShown': isTrue,
    'byTool.text.propsAboveStrip': isTrue,
    'byTool.text.unreachableInProps': isEmpty,
    'byTool.text.canvasClearOfBars': isTrue,
    'byTool.arrow.propsShown': isTrue,
    'byTool.arrow.unreachableInProps': isEmpty,
    'byTool.arrow.canvasClearOfBars': isTrue,
  });
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'mobile-new.png' });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
