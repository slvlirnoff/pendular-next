/**
 * Prints the Mobilis zones of the morning commute Lucens -> Lausanne gare by bus 361 and metro m2
 * (the "7 zones" pass of the SBB shop), as the value of the fork's `allowedSegmentTags` parameter.
 *
 *   pnpm tsx tools/motis-fork/commute-zones.ts
 */
import { loadNova } from '../../packages/engine/src/fares/nova';

const nova = loadNova();
const PLAN = 'mobilis-abo-abo';
const legs: { label: string; stops: string[] }[] = [
  // Bus 361: Lucens, gare - Moudon, gare - Lausanne, Vert-Bois/EHL - Epalinges, Croisettes
  { label: 'bus 361', stops: ['8583110', '8570393', '8592130', '8579239'] },
  // m2: Epalinges, Croisettes - Lausanne, gare (stops in between found along the edges)
  { label: 'm2', stops: ['8579239', '8592050'] },
];
const zones = new Set<number>();
for (const leg of legs) {
  const r = nova.zonesForStops('mobilis', PLAN, leg.stops);
  console.error(`${leg.label}: ${leg.stops.map((s) => nova.stopName(s)).join(' - ')}: zones ${r.zones.join(',')}` + (r.bridged.length ? ` (bridged ${r.bridged.map((b) => `${b.from}-${b.to} via ${b.via.length} stops`).join('; ')})` : '') + (r.missingEdges.length ? ` MISSING ${JSON.stringify(r.missingEdges)}` : ''));
  for (const z of r.zones) zones.add(z);
}
const sorted = [...zones].sort((a, b) => a - b);
console.error(`zones (${sorted.length}): ${sorted.join(', ')}`);
// The evening train Moudon - Lucens, for reference.
console.error(`train Moudon - Lucens: zones ${nova.zonesOnEdge('mobilis', PLAN, '8504120', '8504121')?.join(',')}`);
console.log(sorted.map((z) => `mobilis:${z}`).join(','));
