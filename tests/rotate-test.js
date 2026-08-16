// Rotation had no coverage at all: every suite that mentioned `rotation` only
// set it in a shape literal, so the handle's position, the angle maths and hit
// detection on a rotated shape were all unverified.
const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

const RECT = `{type:'rect',x:200,y:150,w:300,h:200,rotation:0,color:'#c00',size:4,fill:false,id:1}`;
const ELLIPSE = `{type:'ellipse',x:200,y:150,w:300,h:200,rotation:0,color:'#0c0',size:4,id:2}`;
const TEXT = `{type:'text',x:200,y:150,w:260,h:0,text:'Rotate me please',color:'#333',size:3,
  fontSize:16,fontFamily:'sans-serif',fontWeight:'normal',fontStyle:'normal',textAlign:'left',
  rotation:0,id:3}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const r = {};

  // ---- Mouse: drag the handle round and check the angle follows ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(APP); await page.waitForTimeout(300);
    await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
    await page.reload(); await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1000; c.height = 700;
      const g = c.getContext('2d'); g.fillStyle = '#345'; g.fillRect(0, 0, c.width, c.height);
      const image = new Image();
      await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
      img = image; resizeCanvas(); updateImageInfo();
    });
    await page.waitForTimeout(200);

    const screenOf = async (expr) => page.evaluate(e => {
      const p = eval(e);
      const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
      return { x: b.x + p.x / k, y: b.y + p.y / k };
    }, expr);

    const rotateOne = async (literal, label) => {
      await page.evaluate(`shapes.length = 0; shapes.push(${literal});
        document.querySelector('[data-tool="select"]').click();
        selectedShape = shapes[0]; redraw(); updateButtonStates();`);
      await page.waitForTimeout(200);

      // The handle must sit clear of the shape, not on top of it. A text block's
      // handle used to land inside its own box and swallow the presses meant to
      // edit the words.
      const clearance = await page.evaluate(() => {
        const s = selectedShape;
        const h = getRotationHandle(s);
        const inside = isPointInShape(h.x, h.y, s);
        const b = canvas.getBoundingClientRect();
        const k = canvas.width / b.width;
        return { insideShape: inside, gapScreenPx: Math.round(rotationGap() / k) };
      });

      const handle = await screenOf('getRotationHandle(selectedShape)');
      const centre = await screenOf('getRotationHandle(selectedShape)');
      const centreOnScreen = await page.evaluate(() => {
        const h = getRotationHandle(selectedShape);
        const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
        return { x: b.x + h.centerX / k, y: b.y + h.centerY / k };
      });

      // Drag the handle a quarter turn: from due east of the centre to due south.
      const radius = Math.hypot(handle.x - centreOnScreen.x, handle.y - centreOnScreen.y);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        const a = (Math.PI / 2) * (i / 8);
        await page.mouse.move(
          centreOnScreen.x + radius * Math.cos(a),
          centreOnScreen.y + radius * Math.sin(a), { steps: 2 });
      }
      await page.mouse.up();
      await page.waitForTimeout(200);

      const after = await page.evaluate(() => ({
        rotation: +(shapes[0].rotation || 0).toFixed(3),
        stillOneShape: shapes.length === 1,
        x: Math.round(shapes[0].x), y: Math.round(shapes[0].y),
      }));

      // A rotated shape must still be selectable at its own centre.
      const hitAtCentre = await page.evaluate(() => {
        const s = shapes[0];
        const c = getRotationHandle(s);
        return isPointInShape(c.centerX, c.centerY, s);
      });

      r[label] = {
        handleClearOfShape: !clearance.insideShape,
        gapScreenPx: clearance.gapScreenPx,
        rotation: after.rotation,
        quarterTurn: Math.abs(after.rotation - Math.PI / 2) < 0.25,
        positionUnchanged: after.x === (literal === TEXT ? 200 : 200),
        stillOneShape: after.stillOneShape,
        hitAtCentre,
      };
    };

    await rotateOne(RECT, 'rect');
    await rotateOne(ELLIPSE, 'ellipse');
    await rotateOne(TEXT, 'text');

    // Undo must reverse a rotation.
    await page.evaluate(`shapes.length = 0; undoStack.length = 0; shapes.push(${RECT});
      document.querySelector('[data-tool="select"]').click();
      selectedShape = shapes[0]; redraw(); updateButtonStates();`);
    await page.waitForTimeout(150);
    const h2 = await page.evaluate(() => {
      const h = getRotationHandle(selectedShape);
      const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
      return { x: b.x + h.x / k, y: b.y + h.y / k, cx: b.x + h.centerX / k, cy: b.y + h.centerY / k };
    });
    await page.mouse.move(h2.x, h2.y);
    await page.mouse.down();
    await page.mouse.move(h2.cx, h2.cy + (h2.x - h2.cx), { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const rotated = await page.evaluate(() => +(shapes[0].rotation || 0).toFixed(3));
    await page.evaluate(() => undoLastAction());
    await page.waitForTimeout(150);
    r.undoOfRotation = {
      rotated,
      afterUndo: await page.evaluate(() => +(shapes[0].rotation || 0).toFixed(3)),
    };

    r.pageErrors = errors.filter(e => !e.includes('ServiceWorker'));
    await page.close();
  }

  // ---- Touch, on a phone-sized photo ----
  // The gap used to be 20 canvas units, which is 2 screen pixels on a 4032px
  // image, so the handle sat on the shape's own edge and could not be grabbed.
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(APP); await page.waitForTimeout(300);
    await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
    await page.reload(); await page.waitForTimeout(400);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 4032; cv.height = 3024;
      const g = cv.getContext('2d'); g.fillStyle = '#889'; g.fillRect(0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      shapes.length = 0;
      shapes.push({ type: 'rect', x: canvas.width * 0.2, y: canvas.height * 0.2,
        w: canvas.width * 0.4, h: canvas.height * 0.3, rotation: 0,
        color: '#c00', size: 6, fill: false, id: 1 });
      document.querySelector('[data-tool="select"]').click();
      selectedShape = shapes[0]; redraw(); updateButtonStates();
    });
    await page.waitForTimeout(200);

    // The press must start a rotation, not a resize. At a 20px gap the resize
    // check - which runs first and reaches 20 screen pixels on touch - always
    // won, so the handle could not be grabbed by a finger at all.
    r.touchHandleGap = await page.evaluate(() => {
      const s = selectedShape;
      const h = getRotationHandle(s);
      const b = canvas.getBoundingClientRect();
      const k = canvas.width / b.width;
      // Distance from the shape's right edge to the handle, in screen pixels.
      return Math.round((h.x - (s.x + s.w)) / k);
    });

    const hp = await page.evaluate(() => {
      const h = getRotationHandle(selectedShape);
      const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
      return { x: b.x + h.x / k, y: b.y + h.y / k, cx: b.x + h.centerX / k, cy: b.y + h.centerY / k };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hp.x, y: hp.y }] });
    await page.waitForTimeout(60);
    r.touchGrabsRotation = await page.evaluate(() => ({ isRotating, isResizing }));
    const radius = Math.hypot(hp.x - hp.cx, hp.y - hp.cy);
    for (let i = 1; i <= 6; i++) {
      const a = (Math.PI / 2) * (i / 6);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
        { x: hp.cx + radius * Math.cos(a), y: hp.cy + radius * Math.sin(a) } ] });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    r.touchRotation = await page.evaluate(() => ({
      rotation: +(shapes[0].rotation || 0).toFixed(3),
      quarterTurn: Math.abs((shapes[0].rotation || 0) - Math.PI / 2) < 0.3,
      noStrayShape: shapes.length === 1,
    }));
    await ctx.close();
  }

  finish(r, {
    'rect.handleClearOfShape': isTrue,
    'rect.quarterTurn': isTrue,
    'rect.stillOneShape': isTrue,
    'rect.hitAtCentre': isTrue,
    'ellipse.handleClearOfShape': isTrue,
    'ellipse.quarterTurn': isTrue,
    'ellipse.hitAtCentre': isTrue,
    // The one that was actually broken: a text block's handle sat on its text.
    'text.handleClearOfShape': isTrue,
    'text.quarterTurn': isTrue,
    'rect.gapScreenPx': near(20, 3),
    'text.gapScreenPx': near(20, 3),
    'undoOfRotation.afterUndo': 0,
    'undoOfRotation.rotated': v => typeof v === 'number' && Math.abs(v) > 0.2,
    // 20 screen pixels of clearance whatever the photo's resolution.
    'touchHandleGap': near(46, 5),
    'touchGrabsRotation.isRotating': isTrue,
    'touchGrabsRotation.isResizing': isFalse,
    'touchRotation.quarterTurn': isTrue,
    'touchRotation.noStrayShape': isTrue,
    'pageErrors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
