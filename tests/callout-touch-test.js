const { chromium, devices } = require('playwright');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP); await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload(); await page.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(page);
  const box = await page.evaluate(() => { const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const r = {};
  const reset = () => page.evaluate(() => { shapes.length = 0; selectedShape = null;
    finishBlockEditing(true); closeContextMenu(); redraw(); });

  const drag = async (from, to, pauseBeforeMove = 0) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    if (pauseBeforeMove) await page.waitForTimeout(pauseBeforeMove);
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 }] });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  };

  await page.evaluate(() => document.querySelector('[data-tool="callout"]').click());
  await page.waitForTimeout(150);

  // 1. Normal drag creation by touch.
  await drag({ x: box.x + 60, y: box.y + 80 }, { x: box.x + 260, y: box.y + 150 });
  r.touchDragCreates = await page.evaluate(() => ({
    made: shapes.filter(s => s.type === 'callout').length,
    editorOpen: document.getElementById('calloutTextInput').style.display === 'block',
    focused: document.activeElement === document.getElementById('calloutTextInput'),
  }));

  // 2. How do you commit on a phone? No Ctrl/Cmd key exists.
  await page.keyboard.type('Water damage here');
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('calloutTextInput').blur());
  await page.waitForTimeout(300);
  r.blurCommits = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    return { text: c ? c.text : null, editorClosed: document.getElementById('calloutTextInput').style.display === 'none' };
  });

  // 3. Press-pause-then-drag: does long press hijack the draw?
  await reset();
  await page.waitForTimeout(150);
  await drag({ x: box.x + 60, y: box.y + 250 }, { x: box.x + 240, y: box.y + 320 }, 700);
  r.pauseThenDrag = await page.evaluate(() => ({
    calloutsMade: shapes.filter(s => s.type === 'callout').length,
    menuOpen: document.getElementById('contextMenu').classList.contains('open'),
  }));

  // 4. Plain tap with the callout tool.
  await reset();
  await page.evaluate(() => closeContextMenu());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 150, y: box.y + 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  r.plainTap = await page.evaluate(() => ({
    made: shapes.filter(s => s.type === 'callout').length,
    editorOpen: document.getElementById('calloutTextInput').style.display === 'block',
  }));
  await page.evaluate(() => finishBlockEditing(true));

  // 5. Does the Text tool reopen a callout, as it does for text?
  await reset();
  await page.evaluate(() => {
    shapes.push({type:'callout',x:100,y:100,w:240,h:80,text:'Existing note',color:'#333',size:3,
      fill:true,fillColor:'#fff',fontSize:22,fontFamily:'sans-serif',fontWeight:'normal',
      fontStyle:'normal',textAlign:'left',endStyle:'closedArrow',rotation:0,tipX:500,tipY:400,id:9});
    document.querySelector('[data-tool="text"]').click(); redraw();
  });
  await page.waitForTimeout(200);
  const onCallout = await page.evaluate(() => { const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width; return { x: b.x + 200 / k, y: b.y + 130 / k }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [onCallout] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  r.textToolOnCallout = await page.evaluate(() => ({
    editorValue: document.getElementById('calloutTextInput').value,
    shapeTypes: shapes.map(s => s.type),
  }));


  // 6. Tip must drag independently of the box, by touch.
  await reset();
  await page.evaluate(() => {
    // Positioned relative to the canvas: with no image loaded it is only as
    // large as the container, so fixed coordinates can land off it entirely.
    shapes.push({type:'callout',x:canvas.width*0.1,y:canvas.height*0.1,
      w:canvas.width*0.5,h:70,text:'Note',color:'#333',size:3,
      fill:true,fillColor:'#fff',fontSize:22,fontFamily:'sans-serif',fontWeight:'normal',
      fontStyle:'normal',textAlign:'left',endStyle:'closedArrow',rotation:0,
      tipX:canvas.width*0.6,tipY:canvas.height*0.55,id:11});
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => ({ ...selectedShape }));
  const tipPt = await page.evaluate(() => { const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    return { x: b.x + selectedShape.tipX / k, y: b.y + selectedShape.tipY / k }; });
  await drag(tipPt, { x: tipPt.x + 60, y: tipPt.y + 40 });
  r.touchTipMovesAlone = await page.evaluate(b => {
    const c = selectedShape;
    return { tipMoved: Math.abs(c.tipX - b.tipX) > 10, boxStayed: c.x === b.x && c.y === b.y };
  }, before);

  // 7. Double tap must reopen the editor by touch.
  const bodyPt = await page.evaluate(() => { const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width; const c = selectedShape;
    return { x: b.x + (c.x + c.w/2) / k, y: b.y + (c.y + c.h/2) / k }; });
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [bodyPt] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(300);
  r.doubleTapReopens = await page.evaluate(() =>
    document.getElementById('calloutTextInput').style.display === 'block' &&
    document.getElementById('calloutTextInput').value === 'Note');
  await page.evaluate(() => finishBlockEditing(true));

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
