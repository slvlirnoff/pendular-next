import type { CommuteOption } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import { chf, duration } from '../lib/format.js';
import { KIND_SHAPE, optionName } from '../lib/names.js';

const W = 640;
const H = 300;
const M = { l: 64, r: 16, t: 16, b: 40 };

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function ticks(min: number, max: number, target: number): number[] {
  const step = niceStep(Math.max(max - min, 1), target);
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.01; v += step) out.push(Math.round(v));
  return out;
}

function marker(shape: string, x: number, y: number, r: number) {
  if (shape === 'square') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2} />;
  if (shape === 'diamond') return <path d={`M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}Z`} />;
  if (shape === 'triangle') return <path d={`M${x} ${y - r * 1.2}L${x + r * 1.2} ${y + r}L${x - r * 1.2} ${y + r}Z`} />;
  return <circle cx={x} cy={y} r={r} />;
}

/** Yearly cost against door-to-door time: lower left is better. */
export function TradeoffChart(props: { options: CommuteOption[]; selected: string | null; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const os = props.options;
  if (os.length < 2) return null;

  const xs = os.map((o) => o.durationMin);
  const ys = os.map((o) => o.cost.yearly);
  const xT = ticks(Math.max(0, Math.min(...xs) - 5), Math.max(...xs) + 5, 6);
  const yT = ticks(0, Math.max(...ys) * 1.05, 5);
  const x0 = xT[0]!;
  const x1 = xT[xT.length - 1]!;
  const y1 = yT[yT.length - 1]!;
  const X = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / (y1 || 1)) * (H - M.t - M.b);

  // The efficient frontier: options that no other option beats on both time and cost.
  const frontier = os
    .filter((o) => !os.some((p) => p !== o && p.durationMin <= o.durationMin && p.cost.yearly <= o.cost.yearly && (p.durationMin < o.durationMin || p.cost.yearly < o.cost.yearly)))
    .sort((a, b) => a.durationMin - b.durationMin);
  const onFrontier = new Set(frontier.map((o) => o.id));

  // Labels: place right of the mark, flip left near the right edge, nudge apart vertically.
  const placed: { id: string; x: number; y: number; anchor: 'start' | 'end'; text: string }[] = [];
  for (const o of [...os].sort((a, b) => a.cost.yearly - b.cost.yearly)) {
    const text = optionName(o, t);
    const short = text.length > 30 ? `${text.slice(0, 29)}…` : text;
    const px = X(o.durationMin);
    const anchor: 'start' | 'end' = px > W - 220 ? 'end' : 'start';
    let y = Y(o.cost.yearly) + 4;
    for (let guard = 0; guard < 20 && placed.some((p) => Math.abs(p.y - y) < 14 && Math.abs(p.x - px) < 200); guard++) y -= 14;
    placed.push({ id: o.id, x: px + (anchor === 'start' ? 12 : -12), y: Math.max(M.t + 10, y), anchor, text: short });
  }

  return (
    <section className="card chart">
      <h2>{t('chart.title')}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('chart.title')}>
        {yT.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={W - M.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={M.l - 8} y={Y(v) + 4} textAnchor="end" className="tick">
              {chf(v, lang)}
            </text>
          </g>
        ))}
        {xT.map((v) => (
          <text key={`x${v}`} x={X(v)} y={H - M.b + 18} textAnchor="middle" className="tick">
            {duration(v)}
          </text>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="axis" />
        <text x={W - M.r} y={H - 4} textAnchor="end" className="axis-title">
          {t('chart.x')}
        </text>
        {frontier.length > 1 && <polyline className="frontier" points={frontier.map((o) => `${X(o.durationMin)},${Y(o.cost.yearly)}`).join(' ')} />}
        {os.map((o) => {
          const sel = o.id === props.selected;
          const label = `${optionName(o, t)}: ${chf(o.cost.yearly, lang)}, ${duration(o.durationMin)}`;
          return (
            <g
              key={o.id}
              className={`mark${sel ? ' is-selected' : ''}${onFrontier.has(o.id) ? ' is-frontier' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={sel}
              onClick={() => props.onSelect(o.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onSelect(o.id);
                }
              }}
            >
              <title>{label}</title>
              <circle cx={X(o.durationMin)} cy={Y(o.cost.yearly)} r={16} className="hit" />
              {marker(KIND_SHAPE[o.kind], X(o.durationMin), Y(o.cost.yearly), sel ? 7 : 5.5)}
            </g>
          );
        })}
        {placed.map((p) => (
          <text key={p.id} x={p.x} y={p.y} textAnchor={p.anchor} className={`mark-label${p.id === props.selected ? ' is-selected' : ''}`} onClick={() => props.onSelect(p.id)}>
            {p.text}
          </text>
        ))}
      </svg>
      <p className="chart-key">
        <span className="key-line" aria-hidden="true" /> {t('chart.frontier')}
      </p>
    </section>
  );
}
