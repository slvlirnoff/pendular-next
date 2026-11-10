import type { CommuteOption, Verdict } from '../types.js';

export function verdict(options: CommuteOption[]): Verdict {
  if (options.length === 0) return { costPerHourSaved: {} };
  const min = (f: (o: CommuteOption) => number) => options.reduce((a, b) => (f(b) < f(a) ? b : a));
  const cheapest = min((o) => o.cost.yearly);
  const fastest = min((o) => o.durationMin);
  const greenest = min((o) => o.co2KgPerYear);
  const costPerHourSaved: Record<string, number> = {};
  for (const o of options) {
    const hours = cheapest.hoursPerYear - o.hoursPerYear;
    const extra = o.cost.yearly - cheapest.cost.yearly;
    if (o !== cheapest && hours > 0 && extra > 0) costPerHourSaved[o.id] = Math.round((extra / hours) * 10) / 10;
  }
  return { cheapest: cheapest.id, fastest: fastest.id, greenest: greenest.id, costPerHourSaved };
}
