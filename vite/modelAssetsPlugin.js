import { cp } from 'node:fs/promises';
import path from 'node:path';

export function includePublicAsset(relative) {
  const normalized=relative.replaceAll('\\','/');
  return normalized!=='models'&&!normalized.startsWith('models/')&&normalized!=='textures/garage-lighting.hdr';
}

export default function modelAssetsPlugin(env) {
  const live=String(env.VITE_DEMO_MODE||'true').toLowerCase()==='false';
  let root,outDir,isBuild;
  return {
    name:'supabase-production-models',
    config:()=>live?{build:{copyPublicDir:false}}:undefined,
    configResolved(config){root=config.root;outDir=path.resolve(root,config.build.outDir);isBuild=config.command==='build';},
    async closeBundle(){
      if(!live||!isBuild)return;
      const source=path.join(root,'public');
      await cp(source,outDir,{recursive:true,filter:(file)=>includePublicAsset(path.relative(source,file))});
    },
  };
}
