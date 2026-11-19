const configured=(import.meta.env?.VITE_MODEL_ASSET_BASE_URL||'').trim().replace(/\/+$/,'');

export function assetBaseUrl(input) {
  if(!input) return '';
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new Error('VITE_MODEL_ASSET_BASE_URL must be a public HTTPS folder URL.');
  return url.href.replace(/\/+$/,'');
}
const base=assetBaseUrl(configured);
// The refined car is released with the app so an older hosted v1 car cannot
// silently replace it. The measured garage and its lighting remain on the CDN.
export const CAR_RELEASE='imported-v4';
export const modelUrl=(filename)=>filename==='s6-c5.glb'?`/car-releases/${CAR_RELEASE}/${filename}`:base?`${base}/${filename}`:`/models/${filename}`;
export const lightingUrl=()=>base?`${base}/garage-lighting.hdr`:'/textures/garage-lighting.hdr';
// The copies bundled under public/ stay as a fallback, so a paused storage
// project or a missing upload never leaves the garage blank.
const unique=(list)=>[...new Set(list)];
export const modelUrls=(filename)=>unique([modelUrl(filename),filename==='s6-c5.glb'?modelUrl(filename):`/models/${filename}`]);
export const lightingUrls=()=>unique([lightingUrl(),'/textures/garage-lighting.hdr']);

/** Try each URL in turn; never retries after the caller cancels. */
export async function loadFirst(urls,load,signal) {
  let lastError;
  for(const url of urls) {
    try{return await load(url);}
    catch(error) {
      if(signal?.aborted||error?.name==='AbortError')throw error;
      lastError=error;
      if(url!==urls[urls.length-1])console.warn(`[3d] ${url} failed, trying the bundled copy.`,error);
    }
  }
  throw lastError;
}
export const carLightingUrl=()=>`/car-releases/${CAR_RELEASE}/paint-studio.hdr`;
