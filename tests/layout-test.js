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

      // Every tool must be visible without scrolling, however many there are.
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
  for (const t of ['select', 'rect', 'text', 'arrow', 'callout', 'crop', 'tear']) {
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

  // Controls must hold their place as tools change. The row used to centre
  // itself on its own width, so the line controls slid sideways whenever the
  // fill group appeared or went, and two wrapped rows shared no left edge.
  const anchors = {};
  for (const t of ['rect', 'ellipse', 'arrow', 'text', 'callout']) {
    await page.evaluate(x => document.querySelector(`[data-tool="${x}"]`).click(), t);
    await page.waitForTimeout(180);
    anchors[t] = await page.evaluate(() => {
      const props = document.querySelector('.toolbar-props');
      const pr = props.getBoundingClientRect();
      const rows = new Map();
      [...props.children].forEach(el => {
        const b = el.getBoundingClientRect();
        if (!b.width) return;
        const key = Math.round(b.top);
        if (!rows.has(key) || b.left < rows.get(key)) rows.set(key, b.left);
      });
      const starts = [...rows.values()].map(x => Math.round(x - pr.left));
      return {
        rowStarts: starts,
        // Every row begins at the bar's own edge, not wherever its width
        // happens to centre it.
        rowsShareLeftEdge: starts.every(x => Math.abs(x - starts[0]) <= 1),
        strokeSwatchLeft: Math.round(
          document.getElementById('strokeSwatch').getBoundingClientRect().left),
      };
    });
  }
  const strokeLefts = Object.values(anchors).map(a => a.strokeSwatchLeft);
  anchors.strokeSwatchHoldsItsPlace =
    strokeLefts.every(x => Math.abs(x - strokeLefts[0]) <= 1);

  // A colour swatch has to show its colour. Both previews sit on a light chip
  // for that reason: a dark stroke painted straight onto the dark bar was
  // invisible at the moment you wanted to check what you were drawing in.
  const chips = await page.evaluate(() => {
    const lum = el => {
      const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
      return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]);
    };
    const stroke = document.getElementById('strokePreview');
    const fill = document.getElementById('fillPreview');
    const size = el => { const b = el.getBoundingClientRect();
                         return [Math.round(b.width), Math.round(b.height)]; };
    return { strokeChipLuma: lum(stroke), strokeChip: size(stroke),
             fillChip: size(fill),
             // Equal weight, or the pair does not read as a pair.
             sameSize: String(size(stroke)) === String(size(fill)) };
  });

  // A switch is a pill with a knob that travels along it. Scaling it for touch
  // by setting both sides to 20px made the body a circle and left the knob
  // hanging half outside it when on - a grey blob that read as nothing. Tests
  // that only check state never see that, so this one checks the shape: the
  // knob has to sit inside the body at both ends of its travel.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(180);
  // The knob slides over 0.15s, so each state is read once it has settled -
  // computed style mid-transition reports wherever the animation had got to.
  const readSwitch = () => page.evaluate(() => {
    const el = document.getElementById('fillToggle');
    const b = el.getBoundingClientRect();
    const k = getComputedStyle(el, '::after');
    const shift = new DOMMatrixReadOnly(k.transform).m41;
    const left = parseFloat(k.left) + shift;
    const w = parseFloat(k.width);
    const top = parseFloat(k.top), h = parseFloat(k.height);
    return {
      pill: b.width > b.height * 1.4,
      knobInside: left >= -0.5 && left + w <= b.width + 0.5
               && top >= -0.5 && top + h <= b.height + 0.5,
      travels: Math.round(shift),
    };
  });
  const setSwitch = on => page.evaluate(v => {
    const el = document.getElementById('fillToggle');
    el.checked = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, on);
  await setSwitch(false); await page.waitForTimeout(300);
  const switchOff = await readSwitch();
  await setSwitch(true); await page.waitForTimeout(300);
  const switchOn = await readSwitch();
  await setSwitch(false);
  const fillSwitch = { off: switchOff, on: switchOn };

  finish({
    byTool, swatches, anchors, chips, fillSwitch,
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
    // The tear controls are the widest contextual group there is: four edges,
    // a depth and a button. They wrap onto a second row rather than running
    // off the side.
    'byTool.tear.offScreenInProps': isEmpty,
    'byTool.tear.needsSideScroll': isFalse,
    'byTool.tear.unreachableInProps': isEmpty,
    'byTool.tear.canvasClearOfBars': isTrue,
    'byTool.tear.toolsAllVisible': isTrue,
    'swatches.rect.stroke': isTrue,
    'swatches.rect.fill': isTrue,
    'swatches.ellipse.stroke': isTrue,
    'swatches.ellipse.fill': isTrue,
    'swatches.callout.stroke': isTrue,
    'swatches.callout.fill': isTrue,
    'anchors.rect.rowsShareLeftEdge': isTrue,
    'anchors.arrow.rowsShareLeftEdge': isTrue,
    'anchors.text.rowsShareLeftEdge': isTrue,
    'anchors.callout.rowsShareLeftEdge': isTrue,
    'anchors.strokeSwatchHoldsItsPlace': isTrue,
    'chips.strokeChipLuma': atLeast(180),
    'chips.sameSize': isTrue,
    'fillSwitch.off.pill': isTrue,
    'fillSwitch.off.knobInside': isTrue,
    'fillSwitch.on.pill': isTrue,
    'fillSwitch.on.knobInside': isTrue,
    // It has to actually move, or the two states look the same.
    'fillSwitch.on.travels': atLeast(8),
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
