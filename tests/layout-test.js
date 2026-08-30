const { open, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', reset: false });

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
      // Grouped by where a row sits, not by an exact top: controls of
      // different heights on the same row have tops a pixel or two apart.
      const rows = [];
      [...props.children].forEach(el => {
        const b = el.getBoundingClientRect();
        if (!b.width) return;
        const mid = b.top + b.height / 2;
        const row = rows.find(r => Math.abs(r.mid - mid) < 12);
        if (row) row.left = Math.min(row.left, b.left);
        else rows.push({ mid, left: b.left });
      });
      const starts = rows.map(r => Math.round(r.left - pr.left));
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

  // ---- Every control, under every tool: big enough, and drawn inside itself
  // A styled control can render as nonsense while every assertion about its
  // state still passes - the fill switch was a grey blob for weeks. So this
  // checks the shapes: nothing a control paints inside itself escapes its box,
  // and a finger has 44px to land on. The tap target is the label around a
  // control where there is one, since that is what a tap actually hits.
  const controlGeometry = {};
  for (const t of ['select', 'rect', 'arrow', 'text', 'callout', 'crop']) {
    await page.evaluate(x => document.querySelector(`[data-tool="${x}"]`).click(), t);
    await page.waitForTimeout(180);
    controlGeometry[t] = await page.evaluate(() => {
      const px = v => parseFloat(v) || 0;
      const tooSmall = [], escapes = [];
      document.querySelectorAll(
        '.toolbar button, .toolbar input, .toolbar select, .tool-strip button')
        .forEach(el => {
          if (el.type === 'file') return;
          const target = el.closest('label') || el;
          const t = target.getBoundingClientRect();
          if (!t.width && !t.height) return;
          const name = el.id || el.className.split(' ')[0];
          // Height is the figure that has to hold; a dense row of glyph
          // buttons is allowed to be narrower, as the iOS keyboard is.
          if (t.width < 39.5 || t.height < 43.5) {
            tooSmall.push(`${name} ${Math.round(t.width)}x${Math.round(t.height)}`);
          }
          const b = el.getBoundingClientRect();
          [...el.children].forEach(c => {
            const k = c.getBoundingClientRect();
            if (!k.width && !k.height) return;
            if (k.left < b.left - 0.5 || k.right > b.right + 0.5 ||
                k.top < b.top - 0.5 || k.bottom > b.bottom + 0.5) escapes.push(name);
          });
          for (const pseudo of ['::before', '::after']) {
            const st = getComputedStyle(el, pseudo);
            if (st.content === 'none' || !st.width || st.width === 'auto') continue;
            const shift = new DOMMatrixReadOnly(st.transform).m41;
            const l = px(st.left) + shift, w = px(st.width);
            const tp = px(st.top), h = px(st.height);
            if (l < -0.5 || l + w > b.width + 0.5 || tp < -0.5 || tp + h > b.height + 0.5) {
              escapes.push(`${name}${pseudo}`);
            }
          }
        });
      return { tooSmall, escapes };
    });
  }

  // The status bar's three items ran into each other on a phone: the image
  // size and the pointer coordinates printed as one string with no gap -
  // "Display: 402 x 536 1710, 3335".
  const statusBar = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 3024; cv.height = 4032;
    const g = cv.getContext('2d'); g.fillStyle = '#456'; g.fillRect(0, 0, 40, 40);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'big.png', { type: 'image/png' }));
    await new Promise(res => setTimeout(res, 700));
    document.getElementById('statusLine').textContent = '1710, 3335';
    const items = [...document.querySelectorAll('.status-bar .status-item')]
      .map(el => el.getBoundingClientRect())
      .filter(b => b.width > 0);
    let touching = false;
    for (let i = 1; i < items.length; i++) {
      if (items[i].left - items[i - 1].right < 6) touching = true;
    }
    const bar = document.querySelector('.status-bar').getBoundingClientRect();
    return {
      items: items.length,
      touching,
      insideBar: items.every(b => b.left >= bar.left - 0.5 && b.right <= bar.right + 0.5),
      text: document.getElementById('imageInfo').textContent,
    };
  });

  // ---- Undo and the bin, within reach ----
  // They were in the top corners, which is the hardest place to reach on a
  // phone, and they are the two most used things in the app. They float over
  // the picture at the bottom right instead - clear of the readouts under it,
  // clear of each other, and out of the top bar altogether.
  await page.evaluate(() => {
    document.querySelector('[data-tool="rect"]').click();
    shapes.push({ type: 'rect', x: 100, y: 100, w: 200, h: 150, rotation: 0,
      color: '#e33', size: 5, fill: false, id: newShapeId() });
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(250);
  const floatActions = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const u = document.getElementById('floatUndo').getBoundingClientRect();
    const c = document.getElementById('floatClear').getBoundingClientRect();
    const status = document.querySelector('.status-bar').getBoundingClientRect();
    const props = document.querySelector('.toolbar-props').getBoundingClientRect();
    const onScreen = b => b.width > 0 && b.left >= 0 && b.right <= vw
                       && b.top >= 0 && b.bottom <= vh;
    const clearOf = (b, o) => o.height === 0 || b.bottom <= o.top + 0.5;
    return {
      sizes: [Math.round(u.width), Math.round(u.height)],
      bothOnScreen: onScreen(u) && onScreen(c),
      bigEnough: u.width >= 43.5 && u.height >= 43.5 && c.width >= 43.5 && c.height >= 43.5,
      apart: Math.abs(u.bottom - c.top) > 4 || Math.abs(c.bottom - u.top) > 4,
      clearOfReadouts: clearOf(u, status) && clearOf(c, status)
                    && clearOf(u, props) && clearOf(c, props),
      // The top bar keeps the things you do once a session - open, save,
      // paste - and About, which is where the build number lives now that the
      // status bar has gone from the phone.
      topBarButtons: [...document.querySelectorAll('.toolbar .tb-btn')]
        .filter(b => b.getBoundingClientRect().width > 0).map(b => b.id),
    };
  });

  // They are live, not decoration.
  const floatUndoWorks = await page.evaluate(async () => {
    const before = shapes.length;
    document.getElementById('floatUndo').click();
    await new Promise(res => setTimeout(res, 250));
    return { before, after: shapes.length };
  });

  // And they get out of the way of the editor's own buttons.
  const floatsWhileEditing = await page.evaluate(async () => {
    document.querySelector('[data-tool="callout"]').click();
    const b = canvas.getBoundingClientRect();
    const block = { type: 'callout', x: canvas.width * 0.2, y: canvas.height * 0.2,
      w: canvas.width * 0.4, h: canvas.height * 0.08, text: '', tipX: canvas.width * 0.6,
      tipY: canvas.height * 0.5, color: '#333', size: 3, fill: true, fillColor: '#ffd54a',
      fontSize: 16, fontFamily: 'sans-serif', id: newShapeId() };
    shapes.push(block);
    startBlockEditing(block);
    await new Promise(res => setTimeout(res, 300));
    const visible = document.getElementById('floatActions').getBoundingClientRect().height > 0;
    finishBlockEditing(true);
    return { visible };
  });

  // ---- The property row has to line up on its edges ----
  // It measures perfectly straight and still looks crooked: every element on it
  // reports the same centre, because the eye aligns edges and the row carries
  // boxes 30, 28, 24, 16 and 4 pixels tall. A test on midpoints goes green on
  // the broken row, which is why one never caught this.
  const rowEdges = {};
  for (const t of ['rect', 'arrow', 'text', 'callout']) {
    await page.evaluate(x => document.querySelector(`[data-tool="${x}"]`).click(), t);
    await page.waitForTimeout(200);
    rowEdges[t] = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(
        '.toolbar-props .swatch, .toolbar-props .swatch-label, .toolbar-props .size-slider,'
        + ' .toolbar-props .size-value, .toolbar-props .fill-toggle, .toolbar-props select,'
        + ' .toolbar-props input[type="number"], .toolbar-props .format-btn,'
        + ' .toolbar-props .arrow-style-label, .toolbar-props .crop-btn')]
        .map(el => ({ id: el.id || el.className.split(' ')[0],
                      b: el.getBoundingClientRect() }))
        .filter(x => x.b.width > 0);
      // Grouped into rows by where they sit, since the bar wraps.
      const rows = [];
      for (const x of boxes) {
        const mid = x.b.top + x.b.height / 2;
        const row = rows.find(r => Math.abs(r.mid - mid) < 14);
        if (row) row.items.push(x); else rows.push({ mid, items: [x] });
      }
      return rows.map(r => ({
        count: r.items.length,
        tops: [...new Set(r.items.map(x => Math.round(x.b.top)))].sort((a, b) => a - b),
        bottoms: [...new Set(r.items.map(x => Math.round(x.b.bottom)))].sort((a, b) => a - b),
        heights: [...new Set(r.items.map(x => Math.round(x.b.height)))].sort((a, b) => a - b),
      }));
    });
  }
  // One top edge and one bottom edge per row, give or take a pixel.
  const linedUp = rows => rows.every(r =>
    r.tops[r.tops.length - 1] - r.tops[0] <= 1 &&
    r.bottoms[r.bottoms.length - 1] - r.bottoms[0] <= 1);
  const edgesLineUp = Object.fromEntries(
    Object.entries(rowEdges).map(([k, v]) => [k, linedUp(v)]));

  // ---- The two rows of controls are the same height ----
  // They were 46 and 44: the same 44px box in both, but the property track's
  // own border sits outside its height while a chip's sits inside it. Two
  // pixels, on two rows stacked directly on top of each other, which is where
  // a difference that size is most visible.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(200);
  const rowMatch = await page.evaluate(() => {
    const h = sel => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : null;
    };
    return {
      track: h('#lineGroup'),
      chip: h('.tool-strip .tool-button'),
      insideTrack: h('.toolbar-props .swatch'),
    };
  });
  rowMatch.same = rowMatch.track === rowMatch.chip;

  // ---- Less to look at, and more picture ----
  // Four bands of chrome took 231px of a 664px screen with the callout tool in
  // hand: a top bar, a row of readouts, two rows of properties and the tools.
  // The readouts are gone from the phone, the font controls appear when there
  // is text to format rather than when the tool is picked up, and the outlines
  // round every group and every tool have given way to hairlines.
  const quieter = {};
  await page.evaluate(() => {
    shapes.length = 0; selectedShape = null;
    document.querySelector('[data-tool="callout"]').click();
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(250);
  quieter.armed = await page.evaluate(() => {
    const shown = el => el && getComputedStyle(el).display !== 'none';
    const h = sel => { const el = document.querySelector(sel);
      return shown(el) ? Math.round(el.getBoundingClientRect().height) : 0; };
    const chrome = h('.toolbar') + h('.status-bar') + h('.toolbar-props') + h('.tool-strip');
    return {
      statusBar: shown(document.querySelector('.status-bar')),
      fontGroup: document.getElementById('textFormatGroup').classList.contains('visible'),
      props: h('.toolbar-props'), strip: h('.tool-strip'),
      chrome, percent: Math.round(chrome / window.innerHeight * 100),
    };
  });

  // With a callout selected there is text to format, so the controls come back.
  quieter.selected = await page.evaluate(() => {
    shapes.push({ type: 'callout', x: 60, y: 60, w: 300, h: 90, text: 'x',
      tipX: 400, tipY: 300, color: '#333', size: 3, fill: true, fillColor: '#fd0',
      fontSize: 16, fontFamily: 'sans-serif', id: newShapeId() });
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
    return { fontGroup: document.getElementById('textFormatGroup').classList.contains('visible') };
  });

  // Outlines off, hairlines on - in both rows.
  quieter.look = await page.evaluate(() => {
    const cs = (el, pseudo) => getComputedStyle(el, pseudo);
    const group = document.querySelector('#lineGroup');
    const fill = document.querySelector('#fillGroup');
    const first = document.querySelector('.tool-strip .tool-button');
    const second = document.querySelectorAll('.tool-strip .tool-button')[1];
    const btn = first.getBoundingClientRect();
    const icon = first.querySelector('.tool-icon').getBoundingClientRect();
    const label = first.querySelector('.tool-text').getBoundingClientRect();
    return {
      groupOutline: parseFloat(cs(group).borderTopWidth),
      // Drawn in the gap as a pseudo-element rather than as a border, so that
      // it costs no width and cannot indent a wrapped row.
      groupSeparator: parseFloat(cs(fill, '::before').width) || 0,
      toolOutline: parseFloat(cs(first).borderTopWidth),
      toolSeparator: parseFloat(cs(second).borderLeftWidth),
      // Centred in its button: the same air above the icon as below the label.
      airAbove: Math.round(icon.top - btn.top),
      airBelow: Math.round(btn.bottom - label.bottom),
    };
  });

  const r0 = { quieter };
  // The zoom moved out of the status bar and onto the picture, where it shows
  // only when there is a zoom to undo.
  quieter.zoom = await page.evaluate(async () => {
    const pill = document.getElementById('floatZoom');
    const shown = () => !pill.hidden && pill.getBoundingClientRect().height > 0;
    const atRest = shown();
    setZoom(3, canvas.getBoundingClientRect().left + 40,
               canvas.getBoundingClientRect().top + 40);
    await new Promise(res => setTimeout(res, 200));
    const zoomed = { shown: shown(), reads: pill.textContent };
    pill.click();
    await new Promise(res => setTimeout(res, 300));
    return { atRest, zoomed, backToFit: +viewScale.toFixed(2), goneAgain: !shown() };
  });

  finish({
    byTool, swatches, anchors, chips, fillSwitch, controlGeometry, statusBar, rowMatch, quieter,
    rowEdges, edgesLineUp,
    floatActions, floatUndoWorks, floatsWhileEditing,
    errors: realErrors(errors),
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
    'controlGeometry.select.tooSmall': isEmpty,
    'controlGeometry.select.escapes': isEmpty,
    'controlGeometry.rect.tooSmall': isEmpty,
    'controlGeometry.rect.escapes': isEmpty,
    'controlGeometry.arrow.tooSmall': isEmpty,
    'controlGeometry.arrow.escapes': isEmpty,
    'controlGeometry.text.tooSmall': isEmpty,
    'controlGeometry.text.escapes': isEmpty,
    'controlGeometry.callout.tooSmall': isEmpty,
    'controlGeometry.callout.escapes': isEmpty,
    'controlGeometry.crop.tooSmall': isEmpty,
    'controlGeometry.crop.escapes': isEmpty,
    // Six pixels of daylight between the readouts, and none of them hanging
    // off the end of the bar.
    'statusBar.touching': isFalse,
    'statusBar.insideBar': isTrue,
    'quieter.armed.statusBar': isFalse,
    'quieter.armed.fontGroup': isFalse,
    'quieter.armed.strip': 45,
    'quieter.armed.chrome': v => v <= 140,
    'quieter.selected.fontGroup': isTrue,
    'quieter.zoom.atRest': isFalse,
    'quieter.zoom.zoomed.shown': isTrue,
    'quieter.zoom.zoomed.reads': '300%',
    'quieter.zoom.backToFit': 1,
    'quieter.zoom.goneAgain': isTrue,
    'quieter.look.groupOutline': 0,
    'quieter.look.groupSeparator': v => v >= 1,
    'quieter.look.toolOutline': 0,
    'quieter.look.toolSeparator': v => v >= 1,
    // Within a pixel of each other, rather than 7 above and 14 below.
    'quieter.look.airAbove': v => Math.abs(v - r0.quieter.look.airBelow) <= 1,
    'rowMatch.same': isTrue,
    // And still a finger's worth of height, whatever they agree on.
    'rowMatch.chip': v => v >= 44,
    'edgesLineUp.rect': isTrue,
    'edgesLineUp.arrow': isTrue,
    'edgesLineUp.text': isTrue,
    'edgesLineUp.callout': isTrue,
    'floatActions.bothOnScreen': isTrue,
    'floatActions.bigEnough': isTrue,
    'floatActions.apart': isTrue,
    'floatActions.clearOfReadouts': isTrue,
    'floatActions.topBarButtons': ['openFile', 'download', 'aboutTop', 'pasteImage'],
    'floatUndoWorks.before': 1,
    'floatUndoWorks.after': 0,
    'floatsWhileEditing.visible': isFalse,
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
