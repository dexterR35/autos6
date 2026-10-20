// VITE_ values are compiled into browser assets. Fail before bundling common
// server credentials, including legacy Supabase service-role JWTs.
export function validatePublicEnv(env) {
  const modelBase=(env.VITE_MODEL_ASSET_BASE_URL||'').trim();
  if(String(env.VITE_DEMO_MODE||'true').toLowerCase()==='false'&&!modelBase)throw new Error('Live mode requires VITE_MODEL_ASSET_BASE_URL pointing to Supabase Storage. Local models are only for development/demo previews.');
  if(modelBase) {
    const url=new URL(modelBase);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.includes('/storage/v1/object/public/project-models/'))throw new Error('VITE_MODEL_ASSET_BASE_URL must be the public HTTPS project-models folder in Supabase Storage.');
  }
  for (const [key,value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') || typeof value !== 'string') continue;
    let privateKey = /^(?:sk_(?:test|live)_|rk_(?:test|live)_|whsec_|sb_secret_|re_[A-Za-z0-9]{8})/.test(value);
    if (key === 'VITE_SUPABASE_PUBLISHABLE_KEY' && value.startsWith('eyJ')) {
      try { privateKey ||= JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString()).role === 'service_role'; }
      catch { /* Malformed public key will fail authentication, not expose secrets. */ }
    }
    if (privateKey) throw new Error(`Server credential detected in ${key}. Move it to server/.env before running the frontend.`);
  }
}
