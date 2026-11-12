# Pendular Plural API (first slice)

Base URL `http://127.0.0.1:8788`. JSON in and out. No sign-in yet: this slice runs on a
trusted machine only. Types are in `src/types.ts`.

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /api/health` | | `{ ok, queue: { pendingAddresses, queuedAnalyses } }` |
| `GET /api/places?q=` | | `[{ label, type, lat, lon }]` (search for the site) |
| `GET /api/lists` | | `ListSummary[]` |
| `POST /api/lists` | `{ name, rows: PersonInput[] }` | `ListSummary` (addresses are checked in the background) |
| `GET /api/lists/:id` | | `ListSummary & { analyses: Analysis[] }` |
| `DELETE /api/lists/:id` | | `{ ok }` (removes people, analyses and results) |
| `GET /api/lists/:id/people?status=&offset=&limit=` | | `{ total, people: Person[] }` |
| `PATCH /api/people/:id` | one of `{ address, postcode?, city? }` (checked again), `{ lat, lon }` (placed by hand), `{ candidate: n }` (accept the n-th candidate) | `Person` |
| `POST /api/lists/:id/accept-checks` | | `{ accepted }` (accepts the first candidate of every "check" row) |
| `POST /api/lists/:id/analyses` | `{ name, site: { label, lat, lon }, arrival: { from, to }, weekdays?, settings? }` | `Analysis` (runs in the background) |
| `GET /api/analyses/:id` | | `Analysis & { indicators: Indicators \| null }` |
| `GET /api/analyses/:id/indicators?by=attribute` | | `Indicators` |
| `GET /api/analyses/:id/results?offset=&limit=` | | `{ total, rows: ResultRow[] }` |
| `GET /api/analyses/:id/results/:personId` | | the full comparison of one person (same shape as the planner's result) |
| `GET /api/analyses/:id/export.csv` | | CSV, one row per person |
| `POST /api/analyses/:id/rerun` | | `Analysis` (queued again) |
| `DELETE /api/analyses/:id` | | `{ ok }` |

Statuses: an address is `pending` until checked, then `exact`, `check` or `notfound`;
`manual` after a correction by hand. An analysis waits while its list still has `pending`
addresses, and is `outdated` when the list changed after it ran.
