const configured=(import.meta.env?.VITE_MODEL_ASSET_BASE_URL||'').trim().replace(/\/+$/,'');

export function assetBaseUrl(input) {
  if(!input) return '';
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new Error('VITE_MODEL_ASSET_BASE_URL must be a public HTTPS folder URL.');
  return url.href.replace(/\/+$/,'');
}
const base=assetBaseUrl(configured);
export const modelUrl=(filename)=>base?`${base}/${filename}`:`/models/${filename}`;
export const lightingUrl=()=>base?`${base}/garage-lighting.hdr`:'/textures/garage-lighting.hdr';
