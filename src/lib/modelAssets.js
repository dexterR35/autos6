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
export const CAR_RELEASE='imported-v3';
export const modelUrl=(filename)=>filename==='s6-c5.glb'?`/car-releases/${CAR_RELEASE}/${filename}`:base?`${base}/${filename}`:`/models/${filename}`;
export const lightingUrl=()=>base?`${base}/garage-lighting.hdr`:'/textures/garage-lighting.hdr';
export const carLightingUrl=()=>`/car-releases/${CAR_RELEASE}/paint-studio.hdr`;
