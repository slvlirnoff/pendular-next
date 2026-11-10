import type { EngineDeps } from '@pendular/engine';
import { analysePerson } from './analyze.js';
import type { Store } from './store.js';
import type { GeocodeResult } from './types.js';

export interface WorkerDeps {
  store: Store;
  engine: EngineDeps;
  geocoder: { check(input: { address?: string; postcode?: string; city?: string }): Promise<GeocodeResult> };
  /** Addresses checked at the same time (the address service asks for restraint). */
  geocodeConcurrency?: number;
  /** People analysed at the same time; each one is a few dozen routing calls. */
  analysisConcurrency?: number;
  log?: (msg: string) => void;
}

/** Runs `work` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

/**
 * The background worker: checks addresses first, then runs analyses, one at a time.
 *
 * All state lives in the database. After a restart it simply looks again: pending addresses are
 * still pending, a running analysis continues with the people that have no result yet. A wake-up
 * that arrives while it is busy is not lost, because it always looks once more before sleeping.
 */
export function startWorker(d: WorkerDeps) {
  const log = d.log ?? ((m: string) => console.log(`[worker] ${m}`));
  let wake: (() => void) | null = null;
  let poked = false;
  let stopped = false;

  /** One round of work. Returns false when there was nothing to do. */
  async function round(): Promise<boolean> {
    const pending = await d.store.pendingPeople(40);
    if (pending.length) {
      await pool(pending, d.geocodeConcurrency ?? 4, async (p) => {
        let r: GeocodeResult;
        try {
          r = await d.geocoder.check({ address: p.address ?? undefined, postcode: p.postcode ?? undefined, city: p.city ?? undefined });
        } catch {
          // The service failed, not the address: say so, and let a human look.
          r = { status: 'notfound', candidates: [], reasons: ['serviceError'] };
        }
        await d.store.saveCheck(p.id, r);
      });
      return true;
    }

    const a = await d.store.nextAnalysis();
    if (!a) return false;
    if (a.status === 'queued') {
      await d.store.startAnalysis(a.id);
      log(`analysis ${a.id} started`);
    }
    const batch = await d.store.peopleToAnalyse(a.id, a.listId, 24);
    if (batch.length === 0) {
      const versions = await d.engine.routing.versions();
      await d.store.finishAnalysis(a.id, { data: { ...versions, tariffs: d.engine.tariffVersion, parking: d.engine.parkingVersion }, rules: d.engine.rules });
      log(`analysis ${a.id} done`);
      return true;
    }
    await pool(batch, d.analysisConcurrency ?? 4, async (p) => {
      const { row, detail } = await analysePerson(p, a, d.engine);
      await d.store.saveResult(a.id, p.id, row, detail);
    });
    return true;
  }

  (async () => {
    while (!stopped) {
      let worked = false;
      try {
        worked = await round();
      } catch (e) {
        log(`error: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (worked || poked) {
        poked = false;
        continue;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  })();

  return {
    /** New work may be waiting. */
    poke() {
      poked = true;
      wake?.();
    },
    stop() {
      stopped = true;
      wake?.();
    },
  };
}
