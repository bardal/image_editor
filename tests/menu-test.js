const { open, canvasBox, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', settle: 400, resetSettle: 400 });

  const cdp = await ctx.newCDPSession(page);
  const box = await canvasBox(page);
  const r = {};

  const longPress = async (pt, holdMs = 700) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  };
  const menuItems = () => page.evaluate(() =>
    [...document.querySelectorAll('#contextMenu button')].map(b => b.textContent));

  // Long-press blank canvas.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  await page.waitForTimeout(150);
  await longPress({ x: box.x + box.w * 0.5, y: box.y + box.h * 0.4 });
  r.blankMenu = await menuItems();
  r.menuOpen = await page.evaluate(() => document.getElementById('contextMenu').classList.contains('open'));
  r.noStrayShape = await page.evaluate(() => shapes.length === 0);

  // Dismiss, then long-press a shape.
  await page.evaluate(() => closeContextMenu());
  await page.evaluate(() => {
    shapes.push({type:'rect', x:100, y:100, w:300, h:200, rotation:0, color:'#c00', size:5, fill:false, id:1});
    shapes.push({type:'rect', x:500, y:400, w:200, h:150, rotation:0, color:'#00c', size:5, fill:false, id:2});
    redraw();
  });
  await page.waitForTimeout(200);
  // The middle of the shape, not its top edge. This used to press exactly on
  // the line y = 100, which is the boundary of the polygon the hit test runs:
  // whether it counted came down to whether the screen-to-canvas conversion
  // landed on 99.999996 or 100.000004, and that moved with the height of the
  // chrome. A press meant for a shape should be aimed at the shape.
  const shapePt = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
    return { x: b.x + (100 + 150) / k, y: b.y + (100 + 100) / k };
  });
  await longPress(shapePt);
  r.shapeMenu = await menuItems();

  // Bring to front: shape 1 starts behind shape 2.
  r.orderBefore = await page.evaluate(() => shapes.map(s => s.id));
  await page.evaluate(() => [...document.querySelectorAll('#contextMenu button')]
    .find(b => b.textContent === 'Bring to front').click());
  await page.waitForTimeout(250);
  r.orderAfterFront = await page.evaluate(() => shapes.map(s => s.id));

  // Duplicate.
  await longPress(shapePt);
  await page.evaluate(() => [...document.querySelectorAll('#contextMenu button')]
    .find(b => b.textContent === 'Duplicate').click());
  await page.waitForTimeout(250);
  r.afterDuplicate = await page.evaluate(() => ({
    count: shapes.length,
    offset: (() => { const a = shapes.find(s=>s.id===1), b = shapes[shapes.length-1];
      return { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y) }; })(),
    selectedIsCopy: selectedShape === shapes[shapes.length - 1],
  }));

  // Send to back.
  await page.evaluate(() => { selectedShape = shapes[shapes.length-1]; });
  const dupPt = await page.evaluate(() => {
    const s = shapes[shapes.length-1];
    const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
    return { x: b.x + (s.x + s.w/2) / k, y: b.y + s.y / k };
  });
  await longPress(dupPt);
  await page.evaluate(() => [...document.querySelectorAll('#contextMenu button')]
    .find(b => b.textContent === 'Send to back').click());
  await page.waitForTimeout(250);
  r.sentToBackIsFirst = await page.evaluate(() => shapes[0].id === shapes.find((s,i)=>i===0).id);

  // A drag must NOT open the menu.
  await page.evaluate(() => closeContextMenu());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x: box.x+60, y: box.y+400}] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x: box.x+60+i*12, y: box.y+400}] });
    await page.waitForTimeout(90);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  r.dragDidNotOpenMenu = await page.evaluate(() =>
    !document.getElementById('contextMenu').classList.contains('open'));

  // Menu must stay on screen when pressed near an edge.
  await longPress({ x: box.x + box.w - 6, y: box.y + box.h - 6 });
  r.staysOnScreen = await page.evaluate(() => {
    const m = document.getElementById('contextMenu').getBoundingClientRect();
    return m.right <= window.innerWidth + 1 && m.bottom <= window.innerHeight + 1 && m.left >= 0 && m.top >= 0;
  });

  r.errors = realErrors(errors);
  finish(r, {
    'blankMenu': ['Paste image', 'Open image…'],
    'menuOpen': isTrue,
    'noStrayShape': isTrue,
    'shapeMenu': ['Duplicate', 'Bring to front', 'Send to back', 'Delete'],
    'orderBefore': [1, 2],
    'orderAfterFront': [2, 1],
    'afterDuplicate.count': 3,
    'afterDuplicate.selectedIsCopy': isTrue,
    'sentToBackIsFirst': isTrue,
    // A drag that hesitates is still a drag, not a long press.
    'dragDidNotOpenMenu': isTrue,
    'staysOnScreen': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
