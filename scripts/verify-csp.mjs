// Builds the live site with GTM and all ad pixels configured, serves it under the real
// production CSP, and checks in Edge: nothing third-party loads before consent, every
// tracker loads after it without CSP violations, withdrawal stops them, and the Stripe
// session id never reaches the address a tracker can read.
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
const PIXELS={VITE_META_PIXEL_ID:'123456789012345',VITE_TIKTOK_PIXEL_ID:'C0TESTPIXEL12345',VITE_GOOGLE_ADS_ID:'AW-123456789',VITE_GOOGLE_ADS_DONATION_LABEL:'DonationLabel_1'};
const BUILD_ENV={VITE_GTM_ID:'GTM-TEST123',VITE_MODEL_ASSET_BASE_URL:assetBase,VITE_DEMO_MODE:'false',VITE_SITE_URL:'https://projects6.example',...PIXELS};
try {
  Object.assign(process.env,BUILD_ENV);
  await build({root:resolve('.'),logLevel:'silent',build:{outDir:out,emptyOutDir:true}});
  assert.equal(existsSync(join(out,'models/s6-c5.glb')),false,'Live build excludes local models');
  assert.equal(existsSync(join(out,'textures/garage-lighting.hdr')),false,'Live build excludes local lighting');
  assert.equal(existsSync(join(out,'favicon.ico')),true,'Other public assets are retained');
  assert.equal(existsSync(join(out,'parts/hood/index.html')),true,'Part pages are pre-rendered');
  const publicEnv=loadEnv('production',resolve('.'),'VITE_');
  server=createApp({config:{...readConfig({SUPABASE_URL:publicEnv.VITE_SUPABASE_URL,...PIXELS,VITE_GTM_ID:BUILD_ENV.VITE_GTM_ID}),serveStatic:true,distDir:out,modelAssetBaseUrl:assetBase}}).listen(0,'127.0.0.1');
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
  // Third parties are stubbed: count requests, never contact the real services.
  const thirdParty=[];
  const stub=(pattern,flag)=>page.route(pattern,async route=>{thirdParty.push(route.request().url());await route.fulfill({status:200,contentType:'application/javascript',body:`window.${flag}=true;`});});
  await stub('https://www.googletagmanager.com/gtm.js**','__gtmLoadedForTest');
  await stub('https://www.googletagmanager.com/gtag/js**','__adsLoadedForTest');
  await stub('https://connect.facebook.net/**','__metaLoadedForTest');
  await stub('https://analytics.tiktok.com/**','__tiktokLoadedForTest');
  const count=(host)=>thirdParty.filter(u=>u.includes(host)).length;
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__policyViolations=[];
    document.addEventListener('securitypolicyviolation',e=>window.__policyViolations.push(`${e.violatedDirective}: ${e.blockedURI}`));
  });

  await page.goto(`${base}/community`);
  await page.getByRole('heading',{level:1}).waitFor();
  assert.equal(thirdParty.length,0,'No third-party request before consent');
  await page.getByRole('button',{name:'Accept all'}).click();
  await page.waitForFunction(()=>window.__gtmLoadedForTest&&window.__metaLoadedForTest&&window.__tiktokLoadedForTest&&window.__adsLoadedForTest);
  assert.deepEqual([count('gtm.js'),count('facebook'),count('tiktok'),count('gtag/js')],[1,1,1,1],'GTM and each pixel load once after opt-in');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[],'Production CSP permits the app, GTM and the configured pixels');

  // The Stripe return: the session id must leave the address before any tracker starts.
  await page.goto(`${base}/donation/success?session_id=cs_test_cspcheck123456`);
  await page.getByRole('heading',{level:1}).waitFor();
  await page.waitForFunction(()=>window.__gtmLoadedForTest&&window.__metaLoadedForTest);
  assert.equal(page.url(),`${base}/donation/success`,'Session id removed from the address');
  assert.ok(!thirdParty.some(u=>u.includes('cs_test_cspcheck')),'No third-party request carries the session id');
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('project-s6:url-secrets')).session_id),'cs_test_cspcheck123456','The page keeps it for its own status lookup');

  await page.goto(`${base}/privacy`);
  await page.getByRole('button',{name:'Manage cookie choices'}).click();
  await page.getByRole('button',{name:'Reject all',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('project-s6:analytics-consent')==='denied'&&localStorage.getItem('project-s6:marketing-consent')==='denied'&&!window.__s6GtmStarted&&!window.fbq);
  const before=thirdParty.length;
  await page.reload();
  await page.getByRole('heading',{name:'Privacy notice'}).waitFor();
  await page.waitForTimeout(500);
  assert.equal(thirdParty.length,before,'Withdrawal stops every tracker on later loads');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[]);

  await page.goto(`${base}/`);
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({timeout:30000});
  // The car ships with the app (/car-releases); the garage and its lighting come from Supabase.
  assert.equal(modelRequests,2,'Garage model and precomputed lighting come from the configured Supabase URL');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[],'Worker, Meshopt WASM and cross-origin model requests comply with CSP');
  assert.deepEqual(errors,[]);
  const report={passed:true,checks:['Built app loads under real CSP','No third-party request before consent','GTM, Meta, TikTok and Google Ads load once after opt-in, without CSP violations','Stripe session id removed from the address before trackers start, and never sent to them','Withdrawal stops every tracker','Live build excludes local model and lighting files','Configured Supabase model URLs work (intercepted local fixtures)','Worker and Meshopt WASM comply with CSP','No CSP violations or runtime errors']};
  mkdirSync('output/funding-verification',{recursive:true});
  writeFileSync('output/funding-verification/csp-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  for (const key of Object.keys(BUILD_ENV)) delete process.env[key];
  if(browser) await browser.close();
  if(server) await new Promise(r=>server.close(r));
  // Verify the resolved recursive-delete target, using the same Node filesystem API.
  assert.equal(dirname(resolve(out)),resolve(tmpdir()));
  assert.ok(basename(out).startsWith('s6-csp-'));
  rmSync(out,{recursive:true,force:true});
}
