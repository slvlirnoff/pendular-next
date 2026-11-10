# NOVA import

Copies the public part of NOVA (the Swiss public-transport sales platform's fare data) from the
linked-data pilot on LINDAS into `packages/engine/data/nova/`, where `packages/engine/src/fares/nova.ts`
reads it. Source, licence and caveats: `packages/engine/data/nova/SOURCES.md`.

## Run

```
pnpm tsx tools/nova-import/import.ts                                  # everything
pnpm tsx tools/nova-import/import.ts --only=zones --alliance=mobilis  # one network's zones
pnpm tsx tools/nova-import/import.ts --only=relations                 # tariff kilometres
pnpm tsx tools/nova-import/import.ts --only=prices
pnpm tsx tools/nova-import/import.ts --dry-run                        # build and compare, write nothing
pnpm tsx tools/nova-import/import.ts --fresh                          # ignore cached pages
pnpm tsx tools/nova-import/import.ts --no-derive                      # snapshot only, no derived files
```

No key is needed. Behind a proxy that Node's `fetch` does not pick up by itself, run with
`NODE_USE_ENV_PROXY=1` (Node 22.21 or later).

A full run makes **159 requests (84 MB of CSV) and takes about 5½ minutes** (10.11.2026: 336 s,
of which 269 s waiting for the endpoint). Requests are sent one at a time with a 0.4 s pause; a
timeout or a 5xx answer is retried after 5, 20, 60 and 120 s; a 4xx answer stops the run.

Every answer is stored under `tools/nova-import/cache/pages/` (git-ignored). A run that stops
half-way picks up from there when started again. The source is rebuilt daily, so pages older
than 20 hours are thrown away and the run starts over; `--fresh` forces that.

Whatever the options, labels (`meta.jsonl`) and stop names (`stops.jsonl`) are always refreshed
(19 small requests). Sections that are not imported keep their files and their date in
`manifest.json`. `--alliance` only narrows the zone files; the edge attributes
(`edges.jsonl`, `short-routes.jsonl`) are national and are refreshed with any zone import.

## What a run prints

The new snapshot is built in `cache/next/`, compared with the one in the repository, then
copied over it. The comparison is printed and kept in `cache/diff-<date>.txt`:

- per alliance and zoning plan: edges added and removed, edges whose zones changed (old → new,
  with stop names), stops added and removed, zones added and dropped;
- relations: line areas added and removed, and inside areas present before and after: stop
  pairs added, removed, and tariff values changed (first twelve listed);
- products (tarifs) added and removed, number of price entries per price table;
- warnings (also in `manifest.json`).

## What to check before committing

1. The summary line: about 160 requests, no retries left unexplained, total size near 14 MB
   (limit agreed for the repository: 30 MB, no file over 10 MB).
2. Counts in `manifest.json` against the previous commit: 35 alliances, about 47 000 edges,
   577 000 relations in 3 454 areas. A section that shrinks by more than a few percent is more
   likely a problem at the source ("finished pilot, best effort") than a tariff change: look at
   the diff before accepting it.
3. The diff itself. Zone changes are expected at the timetable change in December and when a
   network redraws its plan; relation changes when lines open or close.
4. `pnpm vitest run packages/engine/test/nova.test.ts`. The tests pin real values (Lucens –
   Moudon zones 60 and 103, Romont – Lausanne 41 km, Lausanne – Bern 105 km ...). A failing value
   is either a real tariff change (update the test and say so in the commit) or a broken import.
5. Optionally `pnpm tsx tools/nova-import/compare.ts > tools/nova-import/cache/comparison-tables.md`
   and compare with the tables in `packages/engine/data/nova/COMPARISON.md`.

Prices: NOVA shows one undated state, the prices in force on the day of the import. A run just
after 13 December is the one that picks up a new tariff year.

## Snapshot layout

All files except `manifest.json` are JSON Lines: the first line is a header object (it
describes the records), then one record per line, sorted, so that a change in the source
changes few lines. Stop numbers are integers (DiDok / UIC numbers, the `8504121` of the
timetable ids).

| File | Records |
| --- | --- |
| `manifest.json` | endpoint, date of each section, size and record count of each file, counts, per-alliance counts (plans, zones, edges, stops), warnings, requests of the last import |
| `meta.jsonl` | `["alliance", id, label]`, `["tarif", id, identifier, label, provider]`, `["paylevel", tarif, level, type, validity, unit, zones from, zones to, route type, label de, label fr, [local networks]]`, `["localnetwork", id, label, alliance, plan]`, `["awb", id, label, route condition, operator condition]`, `["segment", id, label, identifier, label fr, min age, max age, type]`, `["table", id, label, unit, precalculated 0/1, prices]`, `["provider", number, short name, name]` |
| `zones/<alliance>.jsonl` | `["plan", id, label, type, [tarifs]]`, `["zone", plan index, code, label, price factor, provider, [pay levels]]`, then one line per edge: `[stopA, stopB, mode, operator, zones in plan 0, zones in plan 1, ...]` where mode is `R` rail, `B` bus, `S` boat, and a plan's entry is a list of zone codes, the index of an earlier plan with the same list, or `null` (edge not in that plan; trailing nulls are dropped) |
| `edges.jsonl` | `["awbSet", hash, [Anwendungsbereich ids]]`, then `[stopA, stopB, mode, operator, awbSet hash or 0, ...local network ids]` for every edge |
| `short-routes.jsonl` | `["set", hash, KURZ/LANG, [pay levels]]`, then `[set hash, from stop, ...to stops]`: stop pairs sold as a short (or long) trip |
| `relations-<n>.jsonl` | one line area per line: `ids`, `label`, `provider`, `variants` (`[area id, price table, class type, number, line code]`), `stops` (ascending), `tw` (tariff values) and, when different, `eff` (effective km), in triangle order of the stops (0-1, 0-2, ... 1-2, ...) or at the triangle positions `k` when only some pairs exist; `prio` and exceptions `prioEx` |
| `prices.jsonl` | `["tw", price table, value from, value to, class, fahrart, duration value, duration unit, price, currency, ...segments]`, `["zone", source id, price, currency, class, frequency code, ...segments]` |
| `stops.jsonl` | `[number, name]` for every stop the other files use |

Decisions taken while packing:

- An edge's operator exists only in its IRI (`transportedge/<stop>/<stop>/<operator>/<mode>/<kind>`)
  and is taken from there; stops and mode come from the edge's properties.
- Line areas that are identical in everything but their price table (the same area exists for
  T601 single tickets and for T650 route passes) are stored once with both tables: 3 454 areas
  become 3 166. Most T601/T650 twins are *not* identical and are kept apart (see COMPARISON.md).
- 47 zone price entries without a price are left out. 500 stop numbers have no name in DiDok
  (they stay usable, `stopName` returns undefined).

## Derived files (`derive.ts`)

After the snapshot is written, `import.ts` runs two more steps on it (skip them with `--no-derive`):

| Step | Runs when | Writes |
| --- | --- | --- |
| `ladders` | the `prices` section was imported | `packages/engine/data/nova/price-ladders/<alliance>.json` and `REPORT.md` there: zone-count price ladders per network, in the format of `data/tariffs/networks/*.json` |
| `network-zones` | the `zones` section was imported for all alliances | `packages/engine/data/nova/network-zones.json` and `NETWORK-ZONES.md`: per zone, the stops shared with a neighbouring network and the flag `own` |

Alone, on the snapshot in the repository:

```
pnpm tsx tools/nova-import/derive.ts                       # both
pnpm tsx tools/nova-import/derive.ts --only=network-zones
pnpm tsx tools/nova-import/derive.ts --only=ladders --dry-run   # prints the report, writes nothing
```

- `ladders` reads the zone price entries again, **with** those that have no price (the snapshot
  leaves 47 out), from the importer's cached pages (same query, `ZONE_PRICE_QUERY`), and matches them
  with the pay levels in `meta.jsonl` by counting. It must therefore run on the pages of the same
  import as the snapshot: run alone on another day it fetches today's entries (3 requests) and, if
  the source changed in between, stops with "cannot be matched by counting" and writes no ladder.
  How the matching works and how it is checked: `packages/engine/data/nova/price-ladders/README.md`.
- `network-zones` adds one query on the DiDok graph (canton of every stop, 2 pages, 27 040 rows).
- Two hand-kept inputs live here: `ladder-reference.json` (known prices a ladder is validated
  against, for networks whose grid is not under `data/tariffs/networks/`) and `zone-primacy.json`
  (what the networks' tariffs say about shared zones; it overrides the computed flag `own`).
- Running `derive.ts` alone when the page cache is older than 20 hours empties the cache first, like
  any import.

What to check before committing them: `price-ladders/REPORT.md` (no alliance marked NOT WRITTEN, the
validated networks still validated, counts of blocks and pay levels equal) and the head of
`NETWORK-ZONES.md` (on how many tariff-documented zones the rule agrees; the four tables of zones).

## Files here

- `import.ts` – the import. `sparql.ts` – cached, polite SPARQL client and CSV reader.
- `derive.ts` – price ladders and the networks' own zones, derived from the snapshot (above); `ladder-reference.json`, `zone-primacy.json` – its hand-kept inputs.
- `compare.ts` – compares the snapshot with the engine's Mobilis zone table and price files;
  prints the tables of COMPARISON.md.
