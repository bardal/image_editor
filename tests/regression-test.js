const { launch, open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const CALLOUT = `{type:'callout',x:canvas.width*0.1,y:canvas.height*0.1,w:canvas.width*0.5,h:70,
  text:'Existing note',color:'#333',size:3,fill:true,fillColor:'#fff',fontSize:22,
  fontFamily:'sans-serif',fontWeight:'normal',fontStyle:'normal',textAlign:'left',
  endStyle:'closedArrow',rotation:0,tipX:canvas.width*0.6,tipY:canvas.height*0.55,id:11}`;

(async () => {
  const browser = await launch();
  const r = {};

  // ---- Finding 1a: touch, hesitating on a handle ----
  {
    const { context: ctx, page } = await open({ browser, device: 'iPhone 13', settle: 400 });
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(`shapes.push(${CALLOUT}); document.querySelector('[data-tool="select"]').click(); selectedShape=shapes[0]; redraw(); updateButtonStates();`);
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => ({ ...selectedShape }));
    const tip = await page.evaluate(() => { const b = canvas.getBoundingClientRect();
      const k = canvas.width / b.width; return { x: b.x + selectedShape.tipX/k, y: b.y + selectedShape.tipY/k }; });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[tip] });
    await page.waitForTimeout(700);                       // hesitate on the handle
    for (let i=1;i<=4;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
      touchPoints:[{x:tip.x+i*15,y:tip.y+i*10}]}); await page.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await page.waitForTimeout(250);
    r.handleDragAfterHesitation = await page.evaluate(b => ({
      tipMoved: Math.abs(selectedShape.tipX - b.tipX) > 5,
      menuOpened: document.getElementById('contextMenu').classList.contains('open'),
    }), before);
    await ctx.close();
  }

  // ---- Finding 1b: mouse, hesitating before dragging a shape ----
  {
    const { page } = await open({ browser, viewport: { width: 1440, height: 900 }, settle: 400 });
    await page.evaluate(() => { shapes.push({type:'rect',x:100,y:100,w:200,h:150,rotation:0,color:'#c00',size:4,fill:false,id:1});
      document.querySelector('[data-tool="select"]').click(); selectedShape=shapes[0]; redraw(); updateButtonStates(); });
    await page.waitForTimeout(200);
    const pt = await page.evaluate(() => { const b=canvas.getBoundingClientRect(); const k=canvas.width/b.width;
      return { x:b.x+(150)/k, y:b.y+(175)/k }; });
    const bx = await page.evaluate(() => shapes[0].x);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.waitForTimeout(700);                        // hesitate with the mouse
    await page.mouse.move(pt.x+80, pt.y+50, { steps:5 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    r.mouseDragAfterHesitation = await page.evaluate(b => ({
      shapeMoved: Math.abs(shapes[0].x - b) > 5,
      menuOpened: document.getElementById('contextMenu').classList.contains('open'),
    }), bx);
    await page.close();
  }

  // ---- Finding 2: text tool tap-away leaves the previous edit unfinished ----
  {
    const { context: ctx, page } = await open({ browser, device: 'iPhone 13', settle: 400 });
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(`shapes.push(${CALLOUT}); document.querySelector('[data-tool="text"]').click(); redraw();`);
    await page.waitForTimeout(200);
    const onCallout = await page.evaluate(() => { const b=canvas.getBoundingClientRect(); const k=canvas.width/b.width;
      const c=shapes[0]; return { x:b.x+(c.x+c.w/2)/k, y:b.y+(c.y+30)/k }; });
    const tapAway = await page.evaluate(() => { const b=canvas.getBoundingClientRect();
      return { x:b.x+b.width*0.85, y:b.y+b.height*0.85 }; });
    // open the callout, clear its text, then tap far away with the text tool
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[onCallout]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(300);
    await page.evaluate(() => { const el=document.getElementById('calloutTextInput');
      el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[tapAway]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(350);
    r.emptiedCalloutTapAway = await page.evaluate(() => ({
      shapeTypes: shapes.map(s => s.type),
      emptyCalloutSurvives: shapes.some(s => s.type==='callout' && !String(s.text||'').trim()),
    }));
    await ctx.close();
  }

  // ---- Finding 3: Escape should cancel, not destroy ----
  {
    const { page } = await open({ browser, viewport: { width: 1440, height: 900 }, settle: 400 });
    await page.evaluate(`shapes.push(${CALLOUT}); document.querySelector('[data-tool="select"]').click(); redraw();`);
    await page.waitForTimeout(200);
    await page.evaluate(() => startBlockEditing(shapes[0]));
    await page.waitForTimeout(200);
    await page.evaluate(() => { const el=document.getElementById('calloutTextInput');
      el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    r.escapeAfterClearing = await page.evaluate(() => ({
      calloutsLeft: shapes.filter(s=>s.type==='callout').length,
      textRestored: shapes[0] ? shapes[0].text : null,
    }));
    await page.close();
  }

  // ---- Finding 4: toolbar keystrokes reaching the canvas shortcuts ----
  // Backspacing the font size box deleted the selected shape, and typing a
  // digit into it started a label on that shape.
  {
    const { page } = await open({ browser, viewport: { width: 1440, height: 900 }, settle: 400 });
    await page.evaluate(`shapes.push(${CALLOUT}); document.querySelector('[data-tool="select"]').click();
      selectedShape = shapes[0]; redraw(); updateButtonStates();`);
    await page.waitForTimeout(200);
    r.fontSizeFieldReachable = await page.evaluate(() =>
      document.getElementById('textFormatGroup').classList.contains('visible'));

    await page.focus('#fontSize');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    r.deleteInFontSizeKeepsShape = await page.evaluate(() => ({
      shapes: shapes.length,
      stillSelected: selectedShape === shapes[0],
      focusStillInField: document.activeElement.id === 'fontSize',
    }));

    // Retyping a size must retitle nothing and resize the text.
    await page.fill('#fontSize', '');
    await page.type('#fontSize', '30');
    await page.waitForTimeout(200);
    r.retypingSizeWorks = await page.evaluate(() => ({
      fontSize: shapes[0] && shapes[0].fontSize,
      labelStarted: !!editingLabelShape,
      text: shapes[0] && shapes[0].text,
    }));

    // With focus back on the page, Delete must still remove the shape.
    await page.evaluate(() => document.getElementById('fontSize').blur());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    r.deleteOnCanvasStillWorks = await page.evaluate(() => shapes.length === 0);
    await page.close();
  }

  finish(r, {
    'handleDragAfterHesitation.tipMoved': isTrue,
    'handleDragAfterHesitation.menuOpened': isFalse,
    'mouseDragAfterHesitation.shapeMoved': isTrue,
    'mouseDragAfterHesitation.menuOpened': isFalse,
    'emptiedCalloutTapAway.emptyCalloutSurvives': isFalse,
    'escapeAfterClearing.calloutsLeft': 1,
    'escapeAfterClearing.textRestored': 'Existing note',
    'fontSizeFieldReachable': isTrue,
    'deleteInFontSizeKeepsShape.shapes': 1,
    'deleteInFontSizeKeepsShape.stillSelected': isTrue,
    'deleteInFontSizeKeepsShape.focusStillInField': isTrue,
    'retypingSizeWorks.fontSize': 30,
    'retypingSizeWorks.labelStarted': isFalse,
    'retypingSizeWorks.text': 'Existing note',
    'deleteOnCanvasStillWorks': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
