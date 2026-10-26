// Offline workshop reflection probe. Narrow practical strips describe the
// clearcoat curvature without extra cameras or passes in the running viewer.
import { mkdirSync, writeFileSync } from 'node:fs';
const width=1024,height=512,bytes=[];
const fixtures=[];
const fixture=(n,d,axes,center,size,color)=>fixtures.push({n,d,axes,center,size,color});
// Staggered white ceiling tubes and their dark housings, above an 8 m bay.
for(const z of [-5,-2,1,4])for(const x of [-3.2,0,3.2]) {
  fixture([0,1,0],3.8,[0,2],[x,z],[2.05,.095],[7.5,8.1,9]);
  fixture([0,1,0],3.8,[0,2],[x,z+.15],[2.05,.055],[1.4,1.5,1.7]);
}
// Side-wall practical lights: mostly neutral, with limited saturated neon.
for(const sign of [-1,1]) {
  fixture([sign,0,0],7,[2,1],[-3.2,1.75],[2.2,.11],[3.5,3.8,4.2]);
  fixture([sign,0,0],7,[2,1],[3.3,1.4],[2.2,.11],[3.2,3.5,3.9]);
  fixture([sign,0,0],7,[2,1],[-.9,.6],[.09,2.25],sign>0?[.025,.28,5.8]:[5,.035,.075]);
  fixture([sign,0,0],7,[2,1],[2.1,1.5],[.085,1.8],sign>0?[4.5,.04,.08]:[.025,.32,5.5]);
}
for(const sign of [-1,1]) {
  fixture([0,0,sign],8,[0,1],[-2.4,1.7],[2.4,.10],[4.0,4.1,4.3]);
  fixture([0,0,sign],8,[0,1],[2.3,.65],[.085,2.1],sign>0?[.025,.3,4.5]:[4,.04,.07]);
}
function room(ray) {
  // Intersect the enclosing workshop. Small surface differences keep dark
  // shelves, ceiling trusses and the floor visible between the fixtures.
  const hits=[];
  if(ray[1]>0)hits.push({t:3.8/ray[1],kind:'ceiling'});
  if(ray[1]<0)hits.push({t:-1/ray[1],kind:'floor'});
  if(ray[0])hits.push({t:7/Math.abs(ray[0]),kind:'side'});
  if(ray[2])hits.push({t:8/Math.abs(ray[2]),kind:'end'});
  const hit=hits.sort((a,b)=>a.t-b.t)[0];
  const p=ray.map(v=>v*hit.t);
  let color;
  if(hit.kind==='ceiling') {
    const truss=Math.abs(p[0]%3.2)<.12||Math.abs(p[2]%3)<.10;
    color=truss?[.008,.011,.017]:[.035,.043,.055];
  } else if(hit.kind==='floor') {
    color=[.025,.032,.043];
  } else {
    const along=hit.kind==='side'?p[2]:p[0];
    const shelving=p[1]<1.2&&p[1]>-.6&&Math.abs(along%2.6)<1.1;
    const column=Math.abs(along%3.7)<.16;
    color=column?[.008,.012,.019]:shelving?[.023,.028,.036]:[.065,.077,.10];
  }
  return color;
}
for(let y=0;y<height;y++) {
  const row=Array.from({length:4},()=>new Uint8Array(width));
  for(let x=0;x<width;x++) {
    const phi=(x+.5)/width*Math.PI*2-Math.PI,theta=(y+.5)/height*Math.PI;
    const ray=[Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)];
    const rgb=room(ray);
    for(const f of fixtures) {
      const dot=ray.reduce((v,r,i)=>v+r*f.n[i],0);
      if(dot<=0)continue;
      const t=f.d/dot;
      if(f.axes.every((axis,i)=>Math.abs(ray[axis]*t-f.center[i])<f.size[i]/2))f.color.forEach((v,i)=>rgb[i]+=v);
    }
    const exponent=Math.ceil(Math.log2(Math.max(...rgb)));
    for(let c=0;c<3;c++)row[c][x]=Math.min(255,Math.round(rgb[c]*256/2**exponent));
    row[3][x]=exponent+128;
  }
  bytes.push(2,2,width>>8,width&255);
  for(const channel of row) {
    let x=0;
    while(x<width) {
      let run=1;while(x+run<width&&run<127&&channel[x+run]===channel[x])run++;
      if(run>=4){bytes.push(128+run,channel[x]);x+=run;continue;}
      const start=x;x+=run;
      while(x<width&&x-start<124){let next=1;while(x+next<width&&next<4&&channel[x+next]===channel[x])next++;if(next>=4)break;x+=next;}
      bytes.push(x-start,...channel.subarray(start,x));
    }
  }
}
const destination='public/car-releases/reference-v2';
mkdirSync(destination,{recursive:true});
const data=Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`),Buffer.from(bytes)]);
writeFileSync(`${destination}/paint-studio.hdr`,data);
console.log(`Wrote ${data.length} bytes of offline car reflections (${width}×${height}).`);
