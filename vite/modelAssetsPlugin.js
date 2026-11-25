import { cp } from 'node:fs/promises';
import path from 'node:path';
import { CAR_RELEASE } from '../src/lib/modelAssets.js';

export function includeCarRelease(relative) {
  const normalized = relative.replaceAll('\\', '/');
  return !normalized.startsWith('car-releases/') || normalized === `car-releases/${CAR_RELEASE}` || normalized.startsWith(`car-releases/${CAR_RELEASE}/`);
}

export function includePublicAsset(relative) {
  const normalized=relative.replaceAll('\\','/');
  return includeCarRelease(relative)&&normalized!=='models'&&!normalized.startsWith('models/')&&normalized!=='textures/garage-lighting.hdr';
}

export default function modelAssetsPlugin(env) {
  const live=String(env.VITE_DEMO_MODE||'true').toLowerCase()==='false';
  let root,outDir,isBuild;
  return {
    name:'supabase-production-models',
    config:()=>({build:{copyPublicDir:false}}),
    configResolved(config){root=config.root;outDir=path.resolve(root,config.build.outDir);isBuild=config.command==='build';},
    async closeBundle(){
      if(!isBuild)return;
      const source=path.join(root,'public');
      await cp(source,outDir,{recursive:true,filter:(file)=>live?includePublicAsset(path.relative(source,file)):includeCarRelease(path.relative(source,file))});
    },
  };
}
