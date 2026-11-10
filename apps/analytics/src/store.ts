import type { Db } from './db.js';
import type {
  AddressCandidate,
  AddressStatus,
  Analysis,
  AnalysisSettings,
  GeocodeResult,
  ListSummary,
  Person,
  PersonInput,
  ResultRow,
} from './types.js';

const STATUSES: AddressStatus[] = ['pending', 'exact', 'check', 'notfound', 'manual'];
export const DEFAULT_SETTINGS: AnalysisSettings = {
  kinds: ['transit', 'car', 'bike', 'ebike', 'walk'],
  weeksOff: 5,
  carCostPerKm: 0.74,
  parkingAtWorkPerMonth: 260,
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toPerson(r: any): Person {
  return {
    id: Number(r.id),
    listId: r.list_id,
    extId: r.ext_id,
    address: r.address,
    postcode: r.postcode,
    city: r.city,
    attrs: r.attrs ?? {},
    status: r.status,
    lat: r.lat,
    lon: r.lon,
    matched: r.matched,
    candidates: r.candidates ?? [],
    reasons: r.reasons ?? [],
  };
}

function toAnalysis(r: any): Analysis {
  return {
    id: r.id,
    listId: r.list_id,
    name: r.name,
    site: { label: r.site_label, lat: r.site_lat, lon: r.site_lon },
    arrival: { from: r.arrival_from, to: r.arrival_to },
    weekdays: r.weekdays,
    settings: r.settings,
    status: r.status,
    outdated: r.list_version != null && r.current_version != null && r.list_version < r.current_version,
    progress: r.progress,
    total: r.total,
    error: r.error,
    stamp: r.stamp ? { car: r.stamp.car ?? null, data: r.stamp.data ?? null } : null,
    createdAt: iso(r.created_at)!,
    finishedAt: iso(r.finished_at),
  };
}

const ANALYSIS_SELECT = `select a.*, l.version as current_version from analyses a join lists l on l.id = a.list_id`;

export function createStore(db: Db) {
  async function listSummaries(id?: string): Promise<ListSummary[]> {
    const { rows } = await db.query(
      `select l.*, coalesce(jsonb_object_agg(s.status, s.n) filter (where s.status is not null), '{}') as counts
         from lists l
         left join (select list_id, status, count(*)::int as n from people group by 1, 2) s on s.list_id = l.id
        ${id ? 'where l.id = $1' : ''}
        group by l.id order by l.created_at desc`,
      id ? [id] : [],
    );
    return rows.map((r) => {
      const byStatus = Object.fromEntries(STATUSES.map((s) => [s, Number(r.counts[s] ?? 0)])) as Record<AddressStatus, number>;
      return {
        id: r.id,
        name: r.name,
        version: r.version,
        createdAt: iso(r.created_at)!,
        updatedAt: iso(r.updated_at)!,
        people: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
      };
    });
  }

  const touch = (listId: string, client: { query: Db['query'] } = db) =>
    client.query(`update lists set version = version + 1, updated_at = now() where id = $1`, [listId]);

  return {
    listSummaries,

    async createList(name: string, rows: PersonInput[]): Promise<ListSummary> {
      const client = await db.connect();
      try {
        await client.query('begin');
        const { rows: made } = await client.query(`insert into lists (name) values ($1) returning id`, [name]);
        const listId = made[0].id as string;
        // Rows with coordinates need no address check.
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const values: unknown[] = [];
          const tuples = chunk.map((p, j) => {
            const placed = typeof p.lat === 'number' && typeof p.lon === 'number';
            values.push(listId, p.extId, p.address ?? null, p.postcode ?? null, p.city ?? null, JSON.stringify(p.attrs ?? {}), placed ? 'manual' : 'pending', placed ? p.lat : null, placed ? p.lon : null);
            const b = j * 9;
            return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
          });
          await client.query(
            `insert into people (list_id, ext_id, address, postcode, city, attrs, status, lat, lon) values ${tuples.join(', ')}
             on conflict (list_id, ext_id) do nothing`,
            values,
          );
        }
        await client.query('commit');
        return (await listSummaries(listId))[0]!;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },

    async deleteList(id: string): Promise<boolean> {
      return ((await db.query(`delete from lists where id = $1`, [id])).rowCount ?? 0) > 0;
    },

    async people(listId: string, status: AddressStatus | undefined, offset: number, limit: number): Promise<{ total: number; people: Person[] }> {
      const where = status ? `list_id = $1 and status = $2` : `list_id = $1`;
      const args = status ? [listId, status] : [listId];
      const total = Number((await db.query(`select count(*) from people where ${where}`, args)).rows[0].count);
      const { rows } = await db.query(`select * from people where ${where} order by id offset $${args.length + 1} limit $${args.length + 2}`, [...args, offset, limit]);
      return { total, people: rows.map(toPerson) };
    },

    async person(id: number): Promise<Person | null> {
      const { rows } = await db.query(`select * from people where id = $1`, [id]);
      return rows[0] ? toPerson(rows[0]) : null;
    },

    /** New address text: back to the queue of the address check. */
    async editAddress(id: number, a: { address: string; postcode?: string; city?: string }): Promise<Person | null> {
      const { rows } = await db.query(
        `update people set address = $2, postcode = $3, city = $4, status = 'pending', lat = null, lon = null, matched = null, candidates = '[]', reasons = '[]', checked_at = null
          where id = $1 returning *`,
        [id, a.address, a.postcode ?? null, a.city ?? null],
      );
      if (rows[0]) await touch(rows[0].list_id);
      return rows[0] ? toPerson(rows[0]) : null;
    },

    /** A position set by hand, or an accepted candidate. */
    async place(id: number, lat: number, lon: number, matched: string | null): Promise<Person | null> {
      const { rows } = await db.query(
        `update people set status = 'manual', lat = $2, lon = $3, matched = coalesce($4, matched), reasons = '[]', checked_at = now() where id = $1 returning *`,
        [id, lat, lon, matched],
      );
      if (rows[0]) await touch(rows[0].list_id);
      return rows[0] ? toPerson(rows[0]) : null;
    },

    /** Accept the first candidate of every row waiting for a check. */
    async acceptChecks(listId: string): Promise<number> {
      const res = await db.query(
        `update people set status = 'manual', matched = candidates->0->>'label', reasons = '[]', checked_at = now()
          where list_id = $1 and status = 'check' and lat is not null`,
        [listId],
      );
      if (res.rowCount) await touch(listId);
      return res.rowCount ?? 0;
    },

    // --- address check queue -------------------------------------------------------------------

    async pendingPeople(limit: number): Promise<Person[]> {
      const { rows } = await db.query(`select * from people where status = 'pending' order by id limit $1`, [limit]);
      return rows.map(toPerson);
    },

    async saveCheck(id: number, r: GeocodeResult): Promise<void> {
      const { rows } = await db.query(
        `update people set status = $2, lat = $3, lon = $4, matched = $5, candidates = $6, reasons = $7, checked_at = now()
          where id = $1 and status = 'pending' returning list_id`,
        [id, r.status, r.lat ?? null, r.lon ?? null, r.matched ?? null, JSON.stringify(r.candidates satisfies AddressCandidate[]), JSON.stringify(r.reasons)],
      );
      if (rows[0]) await touch(rows[0].list_id);
    },

    // --- analyses --------------------------------------------------------------------------------

    async createAnalysis(listId: string, a: { name: string; site: Analysis['site']; arrival: Analysis['arrival']; weekdays: string[]; settings: AnalysisSettings }): Promise<Analysis> {
      const { rows } = await db.query(
        `insert into analyses (list_id, name, site_label, site_lat, site_lon, arrival_from, arrival_to, weekdays, settings)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [listId, a.name, a.site.label, a.site.lat, a.site.lon, a.arrival.from, a.arrival.to, JSON.stringify(a.weekdays), JSON.stringify(a.settings)],
      );
      return (await this.analysis(rows[0].id))!;
    },

    async analysis(id: string): Promise<Analysis | null> {
      const { rows } = await db.query(`${ANALYSIS_SELECT} where a.id = $1`, [id]);
      return rows[0] ? toAnalysis(rows[0]) : null;
    },

    async analysesOfList(listId: string): Promise<Analysis[]> {
      const { rows } = await db.query(`${ANALYSIS_SELECT} where a.list_id = $1 order by a.created_at desc`, [listId]);
      return rows.map(toAnalysis);
    },

    async deleteAnalysis(id: string): Promise<boolean> {
      return ((await db.query(`delete from analyses where id = $1`, [id])).rowCount ?? 0) > 0;
    },

    /** Queue an analysis again from scratch. */
    async rerun(id: string): Promise<Analysis | null> {
      await db.query(`delete from results where analysis_id = $1`, [id]);
      await db.query(`update analyses set status = 'queued', progress = 0, total = 0, error = null, stamp = null, started_at = null, finished_at = null, list_version = null where id = $1`, [id]);
      return this.analysis(id);
    },

    /**
     * The next analysis to work on: one already running (after a restart), else the oldest
     * queued one whose list has no address left to check.
     */
    async nextAnalysis(): Promise<Analysis | null> {
      const { rows } = await db.query(
        `${ANALYSIS_SELECT}
          where a.status in ('running', 'queued')
            and not exists (select 1 from people p where p.list_id = a.list_id and p.status = 'pending')
          order by (a.status = 'running') desc, a.created_at limit 1`,
      );
      return rows[0] ? toAnalysis(rows[0]) : null;
    },

    async startAnalysis(id: string): Promise<void> {
      await db.query(
        `update analyses a set status = 'running', started_at = coalesce(a.started_at, now()), list_version = l.version,
                total = (select count(*) from people p where p.list_id = a.list_id and p.lat is not null)
           from lists l where l.id = a.list_id and a.id = $1`,
        [id],
      );
    },

    /** People with a position that have no result yet in this analysis. */
    async peopleToAnalyse(analysisId: string, listId: string, limit: number): Promise<Person[]> {
      const { rows } = await db.query(
        `select p.* from people p
          where p.list_id = $2 and p.lat is not null
            and not exists (select 1 from results r where r.analysis_id = $1 and r.person_id = p.id)
          order by p.id limit $3`,
        [analysisId, listId, limit],
      );
      return rows.map(toPerson);
    },

    async saveResult(analysisId: string, personId: number, row: Omit<ResultRow, 'personId' | 'extId' | 'attrs' | 'lat' | 'lon'>, detail: unknown): Promise<void> {
      await db.query(
        `insert into results (analysis_id, person_id, row, detail) values ($1, $2, $3, $4)
         on conflict (analysis_id, person_id) do update set row = excluded.row, detail = excluded.detail`,
        [analysisId, personId, JSON.stringify(row), detail == null ? null : JSON.stringify(detail)],
      );
      await db.query(`update analyses set progress = (select count(*) from results where analysis_id = $1) where id = $1`, [analysisId]);
    },

    async finishAnalysis(id: string, stamp: unknown, error?: string): Promise<void> {
      await db.query(`update analyses set status = $2, stamp = coalesce(stamp, '{}'::jsonb) || $3::jsonb, error = $4, finished_at = now() where id = $1`, [id, error ? 'failed' : 'done', JSON.stringify(stamp ?? {}), error ?? null]);
    },

    /** The car assumptions of the analysis (the same for everybody: they depend on the site). */
    async setCarStamp(id: string, car: unknown): Promise<void> {
      await db.query(`update analyses set stamp = coalesce(stamp, '{}'::jsonb) || jsonb_build_object('car', $2::jsonb) where id = $1`, [id, JSON.stringify(car)]);
    },

    async results(analysisId: string, offset = 0, limit = 1_000_000): Promise<{ total: number; rows: ResultRow[] }> {
      const total = Number((await db.query(`select count(*) from results where analysis_id = $1`, [analysisId])).rows[0].count);
      const { rows } = await db.query(
        `select r.row, p.id, p.ext_id, p.attrs, p.lat, p.lon from results r join people p on p.id = r.person_id
          where r.analysis_id = $1 order by p.id offset $2 limit $3`,
        [analysisId, offset, limit],
      );
      return { total, rows: rows.map((r) => ({ ...r.row, personId: Number(r.id), extId: r.ext_id, attrs: r.attrs ?? {}, lat: r.lat, lon: r.lon })) };
    },

    async resultDetail(analysisId: string, personId: number): Promise<unknown | null> {
      const { rows } = await db.query(`select detail from results where analysis_id = $1 and person_id = $2`, [analysisId, personId]);
      return rows[0]?.detail ?? null;
    },

    async queue(): Promise<{ pendingAddresses: number; queuedAnalyses: number }> {
      const a = await db.query(`select count(*) from people where status = 'pending'`);
      const b = await db.query(`select count(*) from analyses where status in ('queued', 'running')`);
      return { pendingAddresses: Number(a.rows[0].count), queuedAnalyses: Number(b.rows[0].count) };
    },
  };
}

export type Store = ReturnType<typeof createStore>;
