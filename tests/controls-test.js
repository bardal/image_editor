// The toolbar controls had no coverage at all - not colour, stroke width, fill,
// font family or size, bold, italic or alignment. Changing a shape's colour was
// the first thing this app was ever asked to do.
const { open, canvasBox, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1500, height: 900 }, resetSettle: 400 });
  const r = {};

  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 1000; cv.height = 700;
    const g = cv.getContext('2d'); g.fillStyle = '#303840'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(600);

  // Drives a control the way a person does: the value changes, then it settles.
  const setControl = (id, value) => page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);

  const selectRect = () => page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });

  // Sampled with nothing selected: the selection outline, its handles and the
  // dashed line from the shape's centre to the rotation handle all paint over
  // the shape and would be read instead of it.
  const pixelAt = async (x, y) => {
    const held = await page.evaluate(() => {
      const s = selectedShape; selectedShape = null; redraw(); return !!s;
    });
    const px = await page.evaluate(([x, y]) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return `rgb(${d[0]},${d[1]},${d[2]})`;
    }, [x, y]);
    if (held) await page.evaluate(() => { selectedShape = shapes[0]; redraw(); updateButtonStates(); });
    return px;
  };

  // ---- Colour and stroke width on an existing shape ----
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'rect', x: 200, y: 150, w: 400, h: 300, rotation: 0,
      color: '#3b8eed', size: 4, fill: false, id: newShapeId() });
    redraw();
  });
  await selectRect();
  await setControl('color', '#ff0000');
  await page.waitForTimeout(150);
  r.colourAppliesToSelection = await page.evaluate(() => shapes[0].color);
  // And it must actually be painted, not merely stored.
  r.colourOnCanvas = await pixelAt(400, 150);

  await setControl('size', '20');
  await page.waitForTimeout(150);
  r.strokeWidth = await page.evaluate(() => ({
    onShape: shapes[0].size,
    // A thicker line covers a point that a thin one missed.
    thickerThanBefore: strokeWidth(20) > strokeWidth(4),
  }));

  // ---- Fill ----
  r.fillBefore = await pixelAt(400, 300);
  await setControl('fillColor', '#00cc00');
  await page.waitForTimeout(150);
  r.afterFillColour = await page.evaluate(() => ({
    fillOn: !!shapes[0].fill,
    fillColour: shapes[0].fillColor,
    // Choosing a fill colour switches fill on, or the swatch lies.
    toggleChecked: document.getElementById('fillToggle').checked,
  }));
  r.fillOnCanvas = await pixelAt(400, 300);

  await setControl('fillToggle', false);
  await page.waitForTimeout(150);
  r.afterFillOff = { fillOn: await page.evaluate(() => !!shapes[0].fill), pixel: await pixelAt(400, 300) };

  // ---- Defaults carry to the next shape drawn ----
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); updateButtonStates(); });
  await setControl('color', '#ffcc00');
  await setControl('size', '9');
  const box = await canvasBox(page);
  await page.evaluate(() => document.querySelector('[data-tool="ellipse"]').click());
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  r.defaultsApplyToNewShape = await page.evaluate(() => ({
    type: shapes[0] && shapes[0].type,
    color: shapes[0] && shapes[0].color,
    size: shapes[0] && shapes[0].size,
  }));

  // ---- Text formatting ----
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'text', x: 150, y: 150, w: 400, h: 0, text: 'Formatting test',
      color: '#ffffff', size: 3, fontSize: 16, fontFamily: 'sans-serif',
      fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', rotation: 0,
      id: newShapeId() });
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  await page.waitForTimeout(150);
  r.formatControlsShown = await page.evaluate(() =>
    document.getElementById('textFormatGroup').classList.contains('visible'));

  const widthOfText = () => page.evaluate(() => Math.round(textBlockMetrics(shapes[0]).lines[0].width || 0));
  const heightBefore = await page.evaluate(() => Math.round(textBlockMetrics(shapes[0]).height));

  await setControl('fontSize', '40');
  await page.waitForTimeout(150);
  r.fontSize = {
    onShape: await page.evaluate(() => shapes[0].fontSize),
    heightBefore,
    heightAfter: await page.evaluate(() => Math.round(textBlockMetrics(shapes[0]).height)),
  };

  await setControl('fontFamily', 'serif');
  await page.waitForTimeout(150);
  r.fontFamily = await page.evaluate(() => ({
    onShape: shapes[0].fontFamily,
    inBuiltFont: buildFont(shapes[0]).includes('serif'),
  }));

  await page.click('#boldToggle');
  await page.waitForTimeout(150);
  r.bold = await page.evaluate(() => ({
    onShape: shapes[0].fontWeight,
    inBuiltFont: buildFont(shapes[0]).includes('bold'),
    buttonActive: document.getElementById('boldToggle').classList.contains('active'),
  }));

  await page.click('#italicToggle');
  await page.waitForTimeout(150);
  r.italic = await page.evaluate(() => ({
    onShape: shapes[0].fontStyle,
    inBuiltFont: buildFont(shapes[0]).includes('italic'),
  }));

  await page.click('#alignCenter');
  await page.waitForTimeout(150);
  r.alignCentre = await page.evaluate(() => ({
    onShape: shapes[0].textAlign,
    buttonActive: document.getElementById('alignCenter').classList.contains('active'),
    leftButtonOff: !document.getElementById('alignLeft').classList.contains('active'),
  }));
  await page.click('#alignRight');
  await page.waitForTimeout(150);
  r.alignRight = await page.evaluate(() => shapes[0].textAlign);

  // Toggling bold back off must return to normal, not stick on.
  await page.click('#boldToggle');
  await page.waitForTimeout(150);
  r.boldOffAgain = await page.evaluate(() => shapes[0].fontWeight);

  // ---- Arrow ends ----
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'arrow', x: 200, y: 200, x2: 600, y2: 400, color: '#fff',
      size: 5, startStyle: 'none', endStyle: 'closedArrow', id: newShapeId() });
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  await page.waitForTimeout(150);
  await setControl('startStyleSelect', 'openArrow');
  await setControl('endStyleSelect', 'none');
  await page.waitForTimeout(150);
  r.arrowEnds = await page.evaluate(() => ({
    start: shapes[0].startStyle,
    end: shapes[0].endStyle,
  }));

  // Everything above must survive a reload, since it is all stored on the shape.
  // The save is debounced, so give it time to land before reloading.
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForTimeout(700);
  r.survivesReload = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    return a ? { start: a.startStyle, end: a.endStyle } : null;
  });

  // ---- Choosing a fill colour on a phone ----
  // Reported from an iPhone: the fill swatch could be found and the iOS colour
  // picker opened, but there was no obvious way to apply the colour. Three
  // things have to hold for that flow to work.
  {
    const { context: ctx2, page: p2, errors: phoneErrors } =
      await open({ browser, device: 'iPhone 13' });
    phoneErrors.forEach(e => errors.push(e));
    const cdp = await ctx2.newCDPSession(p2);

    const armRect = () => p2.evaluate(() => {
      shapes.length = 0; selectedShape = null;
      document.querySelector('[data-tool="rect"]').click();
      redraw(); updateButtonStates();
    });
    await armRect();
    await p2.waitForTimeout(200);

    // A finger on the swatch must reach the colour input behind it, or the
    // picker never opens.
    r.swatchTapReachesInput = await p2.evaluate(() => new Promise(res => {
      const input = document.getElementById('fillColor');
      const swatch = document.getElementById('fillSwatch');
      let reached = false;
      const seen = () => { reached = true; };
      input.addEventListener('click', seen, { once: true });
      const b = swatch.getBoundingClientRect();
      // Where a finger would land, and what the label does with it.
      swatch.click();
      setTimeout(() => {
        input.removeEventListener('click', seen);
        res({ reached, onScreen: b.left >= 0 && b.right <= window.innerWidth });
      }, 200);
    }));

    // The picker reports the chosen colour as it is dragged and again when it
    // closes. A colour that only arrives on the close must still be applied:
    // tapping a swatch in the iOS grid and dismissing is the usual way to use
    // it, and the app listened for the drag alone.
    await p2.evaluate(() => {
      shapes.push({ type: 'rect', x: 100, y: 100, w: 300, h: 200, rotation: 0,
        color: '#3b8eed', size: 4, fill: false, id: newShapeId() });
      document.querySelector('[data-tool="select"]').click();
      selectedShape = shapes[0]; redraw(); updateButtonStates();
    });
    await p2.waitForTimeout(150);
    r.changeAloneApplies = await p2.evaluate(() => {
      const el = document.getElementById('fillColor');
      el.value = '#cc0044';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { fillOn: !!shapes[0].fill, colour: shapes[0].fillColor,
               toggleChecked: document.getElementById('fillToggle').checked };
    });

    // With nothing selected the colour becomes the default for the next shape
    // and the picture does not change, which is what "no obvious way to apply
    // it" looked like. Say so rather than doing nothing visible.
    await p2.evaluate(() => {
      selectedShape = null;
      document.querySelector('[data-tool="rect"]').click();
      document.getElementById('toast').textContent = '';
      redraw(); updateButtonStates();
    });
    await p2.waitForTimeout(150);
    r.saysWhereItWent = await p2.evaluate(() => {
      const el = document.getElementById('fillColor');
      el.value = '#00aa66';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const toast = document.getElementById('toast');
      return { message: toast.textContent, shown: toast.classList.contains('visible') };
    });

    // And that default must actually reach the next shape drawn.
    const box2 = await p2.evaluate(() => {
      const b = canvas.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: box2.x + 40, y: box2.y + 40 }] });
    for (let i = 1; i <= 4; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: box2.x + 40 + i * 25, y: box2.y + 40 + i * 20 }] });
      await p2.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p2.waitForTimeout(250);
    r.nextShapeTakesIt = await p2.evaluate(() => {
      const s = shapes[shapes.length - 1];
      return { fillOn: !!s.fill, colour: s.fillColor };
    });
    await ctx2.close();
  }

  r.errors = realErrors(errors);
  finish(r, {
    'colourAppliesToSelection': '#ff0000',
    'colourOnCanvas': 'rgb(255,0,0)',
    'strokeWidth.onShape': 20,
    'strokeWidth.thickerThanBefore': isTrue,
    'afterFillColour.fillOn': isTrue,
    'afterFillColour.fillColour': '#00cc00',
    'afterFillColour.toggleChecked': isTrue,
    'fillOnCanvas': 'rgb(0,204,0)',
    'afterFillOff.fillOn': isFalse,
    'afterFillOff.pixel': v => v !== 'rgb(0,204,0)',
    'defaultsApplyToNewShape.type': 'ellipse',
    'defaultsApplyToNewShape.color': '#ffcc00',
    'defaultsApplyToNewShape.size': 9,
    'formatControlsShown': isTrue,
    'fontSize.onShape': 40,
    'fontSize.heightAfter': v => typeof v === 'number' && v > 0,
    'fontFamily.onShape': 'serif',
    'fontFamily.inBuiltFont': isTrue,
    'bold.onShape': 'bold',
    'bold.inBuiltFont': isTrue,
    'italic.onShape': 'italic',
    'italic.inBuiltFont': isTrue,
    'alignCentre.onShape': 'center',
    'alignCentre.buttonActive': isTrue,
    'alignCentre.leftButtonOff': isTrue,
    'alignRight': 'right',
    'boldOffAgain': 'normal',
    'arrowEnds.start': 'openArrow',
    'arrowEnds.end': 'none',
    'survivesReload.start': 'openArrow',
    'survivesReload.end': 'none',
    'swatchTapReachesInput.reached': isTrue,
    'swatchTapReachesInput.onScreen': isTrue,
    'changeAloneApplies.fillOn': isTrue,
    'changeAloneApplies.colour': '#cc0044',
    'changeAloneApplies.toggleChecked': isTrue,
    'saysWhereItWent.message': v => typeof v === 'string' && /fill/i.test(v),
    'saysWhereItWent.shown': isTrue,
    'nextShapeTakesIt.fillOn': isTrue,
    'nextShapeTakesIt.colour': '#00aa66',
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
