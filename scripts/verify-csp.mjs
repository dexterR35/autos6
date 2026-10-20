import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { build, loadEnv } from 'vite';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';

const out = mkdtempSync(join(tmpdir(),'s6-csp-'));
let browser, server;
const assetBase='https://assets.supabase.test/storage/v1/object/public/project-models/11111111-1111-4111-8111-111111111111/v1';
try {
  process.env.VITE_GTM_ID='GTM-TEST123';
  process.env.VITE_MODEL_ASSET_BASE_URL=assetBase;
  process.env.VITE_DEMO_MODE='false';
  await build({root:resolve('.'),logLevel:'silent',build:{outDir:out,emptyOutDir:true}});
  assert.equal(existsSync(join(out,'models/s6-c5.glb')),false,'Live build excludes local models');
  assert.equal(existsSync(join(out,'textures/garage-lighting.hdr')),false,'Live build excludes local lighting');
  assert.equal(existsSync(join(out,'favicon.ico')),true,'Other public assets are retained');
  const publicEnv=loadEnv('production',resolve('.'),'VITE_');
  server=createApp({config:{...readConfig({SUPABASE_URL:publicEnv.VITE_SUPABASE_URL}),serveStatic:true,distDir:out,modelAssetBaseUrl:assetBase}}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage();
  let modelRequests=0;
  await page.route(`${assetBase}/**`,async route=>{
    const filename=new URL(route.request().url()).pathname.split('/').at(-1);
    const file=filename==='garage-lighting.hdr'?`public/textures/${filename}`:`public/models/${filename}`;
    modelRequests++;
    await route.fulfill({status:200,contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:readFileSync(file)});
  });
  let gtmRequests=0;
  await page.route('https://www.googletagmanager.com/**',async route=>{
    gtmRequests++;
    await route.fulfill({status:200,contentType:'application/javascript',body:'window.__gtmLoadedForTest=true;'});
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__policyViolations=[];
    document.addEventListener('securitypolicyviolation',e=>window.__policyViolations.push(`${e.violatedDirective}: ${e.blockedURI}`));
  });
  await page.goto(`${base}/community`);
  await page.getByRole('heading',{level:1}).waitFor();
  assert.equal(gtmRequests,0,'No third-party analytics request before consent');
  await page.getByRole('button',{name:'Allow analytics'}).click();
  await page.waitForFunction(()=>window.__gtmLoadedForTest===true);
  assert.equal(gtmRequests,1,'Hashed loader starts after opt-in');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[],'Production CSP permits app and the explicit consent loader');
  await page.goto(`${base}/privacy`);
  await page.getByRole('button',{name:'Manage analytics consent'}).click();
  await page.getByRole('button',{name:'Reject',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('project-s6:analytics-consent')==='denied' && !window.__s6GtmStarted);
  const count=gtmRequests;
  await page.reload();
  await page.getByRole('heading',{name:'Privacy notice'}).waitFor();
  assert.equal(gtmRequests,count,'Revocation prevents the container on subsequent loads');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[]);
  await page.goto(`${base}/`);
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({timeout:30000});
  assert.equal(modelRequests,3,'Both models and precomputed lighting come from the configured Supabase URL');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[],'Worker, Meshopt WASM and cross-origin model requests comply with CSP');
  assert.deepEqual(errors,[]);
  const report={passed:true,checks:['Built app loads under real CSP','No analytics request before consent','Hashed inline loader executes after opt-in','Revocation stops loading','Live build excludes local model and lighting files','Configured Supabase model URLs work (intercepted local fixtures)','Worker and Meshopt WASM comply with CSP','No CSP violations or runtime errors']};
  mkdirSync('output/funding-verification',{recursive:true});
  writeFileSync('output/funding-verification/csp-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  delete process.env.VITE_GTM_ID;
  delete process.env.VITE_MODEL_ASSET_BASE_URL;
  delete process.env.VITE_DEMO_MODE;
  if(browser) await browser.close();
  if(server) await new Promise(r=>server.close(r));
  // Verify the resolved recursive-delete target, using the same Node filesystem API.
  assert.equal(dirname(resolve(out)),resolve(tmpdir()));
  assert.ok(basename(out).startsWith('s6-csp-'));
  rmSync(out,{recursive:true,force:true});
}
