import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const output = resolve('output/funding-verification');
mkdirSync(output,{recursive:true});
const browser = await chromium.launch({channel:'msedge',args:['--enable-unsafe-swiftshader']});
const report = {checks:[],errors:[],screenshots:[]};
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto('http://localhost:5173/');
    await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({timeout:120000});
    assert.equal(await page.locator('.three-toolbar').innerText(),'');
    assert.equal(await page.getByRole('progressbar',{name:'Campaign funding'}).getAttribute('aria-valuenow'),'27');
    await page.getByLabel('Search the parts list').fill('bumper');
    assert.equal(await page.locator('.part-row').count(),2);
    await page.getByLabel('Search the parts list').fill('');
    await page.getByRole('button',{name:'Important',exact:true}).click();
    assert.equal(await page.locator('.part-row').count(),3);
    await page.getByRole('button',{name:'All priorities',exact:true}).click();
    const scroll = await page.locator('.part-rows').evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
    assert.ok(scroll.total>scroll.height,'Parts overflow inside their own list');
    await page.locator('.part-rows').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await page.locator('.part-rows').evaluate(el=>el.scrollTop)>0);
    await page.locator('.part-rows').evaluate(el=>el.scrollTop=0);
    const shot = async(name)=>{const file=`${output}/${name}-${viewport.width}.png`;await page.screenshot({path:file,fullPage:name!=='donation'});report.screenshots.push(file);};
    await shot('garage');
    await page.getByRole('button',{name:'Donate now'}).click();
    const dialog = page.getByRole('dialog',{name:'Support the restoration'});
    await dialog.getByRole('button',{name:'Custom',exact:true}).click();
    await dialog.getByLabel('Custom amount (USD)').fill('12.34');
    await dialog.getByRole('combobox').selectOption('hood');
    await dialog.getByLabel(/I agree to the/).check();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, 'Modal fits the visible viewport');
    await shot('donation');
    await dialog.getByRole('button',{name:/Preview checkout/}).click();
    await dialog.getByRole('heading',{name:'No payment was taken'}).waitFor();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    for (const path of ['/parts','/community','/terms','/privacy']) {
      await page.goto(`http://localhost:5173${path}`);
      await page.getByRole('heading',{level:1}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal page overflow');
      if (path==='/parts') {assert.equal(await page.getByRole('progressbar').count(),10);}
      if (path==='/community') {
        await page.getByRole('button',{name:'Subscribe to build updates'}).click();
        const subscribe=page.getByRole('dialog',{name:'Stay in the build'});
        await subscribe.getByLabel('Email address').fill('preview@example.com');
        await subscribe.getByLabel(/I want email updates/).check();
        await subscribe.getByRole('button',{name:'Send confirmation email'}).click();
        await subscribe.getByRole('heading',{name:'Demo preview · no email sent'}).waitFor();
        await subscribe.getByRole('button',{name:'Done',exact:true}).click();
      }
      await shot(path.slice(1));
    }
    report.checks.push(`${viewport.width}px: 3D icons, part progress and scroll, custom donation and consent, subscription preview, community/legal routes, no horizontal overflow`);
    await page.close();
  }
  assert.deepEqual(report.errors,[]);
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
