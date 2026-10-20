// Generate a small HDR fixture map offline instead of rendering the full garage
// into six reflection cameras in every visitor's browser.
import { mkdirSync, writeFileSync } from 'node:fs';
const width=512,height=256,bytes=[];
const fixtures=[
  {n:[0,1,0],d:3,axes:[0,2],center:[0,-2],size:[7,.18],color:[6,6.5,7]},
  {n:[0,1,0],d:3,axes:[0,2],center:[-4,3],size:[.14,4],color:[5,5.6,6.5]},
  {n:[0,1,0],d:3,axes:[0,2],center:[4,3],size:[.14,4],color:[5,5.6,6.5]},
  {n:[0,0,-1],d:10,axes:[0,1],center:[-3,1],size:[.22,3],color:[.04,.8,8]},
  {n:[0,0,-1],d:10,axes:[0,1],center:[3,1],size:[.22,3],color:[8,.08,.2]},
  {n:[1,0,0],d:12,axes:[2,1],center:[1,1],size:[5,.16],color:[.04,.6,6]},
  {n:[-1,0,0],d:12,axes:[2,1],center:[1,1],size:[5,.16],color:[6,.06,.15]},
];
for(let y=0;y<height;y++) {
  const row=Array.from({length:4},()=>new Uint8Array(width));
  for(let x=0;x<width;x++) {
    const phi=(x+.5)/width*Math.PI*2-Math.PI,theta=(y+.5)/height*Math.PI;
    const ray=[Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)];
    const rgb=[.055,.075,.115].map(v=>v*(.65+.35*Math.max(0,ray[1])));
    for(const f of fixtures) {
      const dot=ray.reduce((v,r,i)=>v+r*f.n[i],0);
      if(dot<=0) continue;
      const t=f.d/dot;
      if(f.axes.every((axis,i)=>Math.abs(ray[axis]*t-f.center[i])<f.size[i]/2)) f.color.forEach((v,i)=>rgb[i]+=v);
    }
    const exponent=Math.ceil(Math.log2(Math.max(...rgb)));
    for(let c=0;c<3;c++) row[c][x]=Math.min(255,Math.round(rgb[c]*256/2**exponent));
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
mkdirSync('public/textures',{recursive:true});
const data=Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`),Buffer.from(bytes)]);
writeFileSync('public/textures/garage-lighting.hdr',data);
console.log(`Wrote ${data.length} bytes of precomputed workshop lighting.`);
