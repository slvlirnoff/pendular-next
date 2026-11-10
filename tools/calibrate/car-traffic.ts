import { loadDensity, TRAFFIC_CLASSES } from '../../packages/engine/src/index.js';
import { wgs84ToLv95 } from '../../packages/engine/src/density.js';
import { buildDeps, readConfig } from '../../apps/api/src/deps.js';
const d = loadDensity(); const deps = buildDeps(readConfig());
const P:any={lovatens:[46.6925,6.8615],epfl:[46.5191,6.5668],lucens:[46.7085,6.8393],gare:[46.5167,6.6291],flon:[46.5207,6.6301],echallens:[46.6413,6.6337],romont:[46.6936,6.9119]};
const G:any={'lucens gare':45,'lucens epfl':45,'lucens flon':45,'echallens flon':35,'echallens epfl':26,'lovatens romont':7};
(async()=>{
for(const [k,g] of Object.entries(G)){const [a,b]=k.split(' ');
 const r=await deps.routing.street({from:{lat:P[a][0],lon:P[a][1]},to:{lat:P[b][0],lon:P[b][1]},profile:'car'});
 const geo=r!.geometry!; const w=[0,0,0,0]; 
 for(let i=1;i<geo.length;i++){const A=wgs84ToLv95(geo[i-1][1],geo[i-1][0]),B=wgs84ToLv95(geo[i][1],geo[i][0]);const len=Math.hypot(B.e-A.e,B.n-A.n);
  const m=d.aroundLv95((A.e+B.e)/2,(A.n+B.n)/2);const den=m.residents+(m.jobs??0);const ci=TRAFFIC_CLASSES.findIndex(c=>den>=c.minDensity);w[ci]+=len/1000;}
 console.log(k.padEnd(16),'free',r!.durationMin.toFixed(1),'km',(r!.distanceM/1000).toFixed(1),'km by class [≥30k,≥10k,≥2k,<2k]',w.map(x=>x.toFixed(1)).join(' '),'google',g,'needed ×',(Number(g)/r!.durationMin).toFixed(2));
}
})();
