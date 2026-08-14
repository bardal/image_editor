const { chromium, devices } = require('playwright');
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
      props.querySelectorAll('button, input, select, label').forEach(el => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        const offsetLeft = el.offsetLeft;
        if (offsetLeft < 0 || offsetLeft + el.offsetWidth > props.scrollWidth + 2) {
          unreachable.push(el.id || el.className);
        }
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
        propsScrollable: props.scrollWidth > props.clientWidth,
        propsScrollWidth: props.scrollWidth,
        unreachableInProps: unreachable,
        // Compare against whichever pinned bar is topmost: the property bar
        // hides itself when nothing in it applies, leaving the tool strip.
        canvasClearOfBars: cr.bottom <= (pr.height > 0 ? pr.top : sr.top) + 1,
        chromeTotalPx: Math.round(document.querySelector('.toolbar').getBoundingClientRect().height + pr.height + sr.height),
        chromePercent: Math.round((document.querySelector('.toolbar').getBoundingClientRect().height + pr.height + sr.height) / vh * 100),
      };
    });
  };

  const byTool = {};
  for (const t of ['select', 'text', 'arrow']) {
    byTool[t] = await check(t);
  }

  // Prove the far end of the property bar can actually be scrolled into view.
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  const scrollProof = await page.evaluate(() => {
    const props = document.querySelector('.toolbar-props');
    props.scrollLeft = props.scrollWidth;
    const last = document.getElementById('alignRight');
    const b = last.getBoundingClientRect();
    return { alignRightVisibleAfterScroll: b.left >= -1 && b.right <= window.innerWidth + 1 };
  });

  console.log(JSON.stringify({
    byTool, scrollProof,
    errors: errors.filter(e => !e.includes('ServiceWorker')),
  }, null, 2));
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'mobile-new.png' });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
