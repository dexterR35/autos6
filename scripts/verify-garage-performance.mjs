import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://localhost:5173';
const output='output/performance-verification';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',args:['--enable-unsafe-swiftshader']});
const report={profiles:[],errors:[]};
try {
  for(const profile of [{name:'desktop',viewport:{width:1440,height:900},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true},{name:'narrow',viewport:{width:320,height:740},deviceScaleFactor:3,isMobile:true,hasTouch:true}]) {
    const context=await browser.newContext(profile);
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.addInitScript(()=>{
      window.__longTasks=[];
      new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>Math.round(e.duration)))).observe({type:'longtask',buffered:true});
    });
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.goto(base);
    const viewer=page.locator('[data-testid="three-viewer"][data-loaded="true"]');
    await viewer.waitFor({timeout:120000});
    const canvas=page.locator('canvas.three-canvas');
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="three-viewer"]')?.dataset.renderScale==='1.00',{},{timeout:12000});
    await page.waitForTimeout(250);
    const result=await viewer.evaluate(el=>({readyMs:Number(el.dataset.readyMs),drawCalls:Number(el.dataset.renderCalls),triangles:Number(el.dataset.triangles),pixelRatio:Number(el.dataset.pixelRatio),scale:Number(el.dataset.renderScale),cssWidth:el.clientWidth,bufferWidth:el.querySelector('canvas').width,longTasks:window.__longTasks,models:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.glb')).map(r=>({name:r.name,bytes:r.decodedBodySize,downloadMs:Math.round(r.duration)}))}));
    assert.equal(result.models.length,2);
    assert.equal(await page.evaluate(()=>innerWidth),profile.viewport.width,'Header does not widen or scale the mobile viewport');
    assert.ok(result.models.reduce((n,m)=>n+m.bytes,0)<3_500_000,'Compressed models stay under 3.5 MB');
    assert.ok(result.drawCalls<160,'Single scene pass, no full-scene mirror or bloom passes');
    assert.equal(result.scale,1,'Resting image returns to full resolution');
    if(profile.name==='mobile')assert.equal(result.pixelRatio,2,'Mobile renders at 2x CSS resolution');
    // A missing worker response would prevent readiness; select a visible car part
    // through the catalogue to verify interactions survive preparation.
    await page.locator('[data-part-row="hood"]').click();
    await page.getByRole('complementary',{name:'Hood',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close part details'}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${output}/${profile.name}.png`,fullPage:false});
    report.profiles.push({name:profile.name,...result});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
