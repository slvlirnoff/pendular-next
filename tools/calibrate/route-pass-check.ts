/**
 * Compares route-pass prices read in the SBB shop (valid 04.01.2027) with our T650 table at the
 * official tariff kilometres. Run: pnpm tsx tools/calibrate/route-pass-check.ts
 */
import { loadNova } from '../../packages/engine/src/index.js';
import { routePass } from '../../packages/engine/src/fares/national.js';

const nova = loadNova();
// [from, to, label, shop annual, shop monthly]
const SHOP: [string, string, string, number, number][] = [
  ['8501120', '8507000', 'Lausanne–Bern direct', 3537, 393],
  ['8504023', '8501214', 'Romont FR–EPFL via Lausanne', 2511, 279],
  ['8504200', '8501120', 'Yverdon–Lausanne', 3807, 423],
  ['8501022', '8501008', 'Versoix–Genève', 1521, 169],
  ['8504086', '8501120', 'Bulle–Lausanne via Palézieux', 2736, 304],
  ['8504121', '8507000', 'Lucens–Bern via Murten–Kerzers', 2952, 328],
  ['8504694', '8504100', 'Lovatens–Fribourg via Lucens–Payerne', 2511, 279],
];
for (const [a, b, label, year, month] of SHOP) {
  const t = nova.tariffKmBetween(a, b, { tariff: 'T650' });
  const km = t?.km ?? null;
  const ours = km ? routePass('month', km, { travelClass: 2, category: 'adult' }) : null;
  console.log(label.padEnd(40), 'km', String(km ?? '-').padStart(4), '| shop', month, year, '| ours month', ours, 'year', km ? routePass('year', km, { travelClass: 2, category: 'adult' }) : null, '| ratio', ours ? (month / ours).toFixed(4) : '-', '| shop year/month', (year / month).toFixed(2), '| parts', t?.parts.map((p) => `${p.km}`).join('+'));
}
