# Address check

Every address of an uploaded list is geocoded and flagged **exact**, **check** (a person should
confirm) or **notfound**. Code: `src/geocode.ts`. Acceptance set and runner: `tools/address-test/`.

```ts
const geocoder = createGeocoder();            // deps: { fetch?, swisstopoUrl?, motisUrl? }
const r = await geocoder.check({ address: 'Rue de Bourg 27', postcode: '1003', city: 'Lausanne' });
// r: GeocodeResult = { status, lat?, lon?, matched?, candidates (max 5, own score 0-1), reasons }
```

## Sources

1. **swisstopo search service** over the official building address register:
   `GET https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=…&type=locations&origins=address&limit=5&sr=4326`.
2. **MOTIS geocoder** (`http://127.0.0.1:8080/api/v1/geocode?text=…`) only as a fallback, when
   swisstopo has nothing that fits (or is down). A fallback match is never better than `check`
   (reason `fallback`; MOTIS gives no postcode, so `postcode` comes with it).

The default HTTP client is `httpGet` of `apps/api` (Node's built-in fetch crashed the project on
large answers). Only the address text is sent, never an identifier.

## How the check decides

The service's rank is not trusted: search services are fuzzy and silently replace a wrong street
or house number by a neighbour. The input is parsed (`parseAddress`) and compared field by field
with every candidate (`scoreCandidate`, `decide`).

**Parsing.** One line or split columns; number before or after the street; `5 bis`/`5 a` (bis=b,
ter=c); ranges (`5-7` is 5); postcode 4 digits (`CH-1003`, or inside the town column); town with
number (`Lausanne 26`) or canton in brackets; country at the end is dropped; abbreviations
(av., ch., rte, pl., bd, str., St/Sankt/Saint); accents, case and hyphens do not matter; `ä/ae`,
`ß/ss` compare equal; bilingual register names (`Collègegasse / Rue du Collège`) match in either
language.

**Street.** Compared as a compact normalised string with Damerau-Levenshtein: at most 1 edit for
names up to 10 characters, 2 for longer ones, digits in the name must be equal. The **street type**
must be the same: rue is not route or chemin, strasse is not weg or gasse, via is not viale (type =
first word for French/Italian, ending of the compound for German). Same name but another type, or a
similar name beyond the tolerance, is only `check` (`street`).

**Town.** With a postcode the town name is not needed, so Biel/Bienne, Fribourg/Freiburg, Zurich/Zürich
all work (a small alias list). It is only a safety net: when the postcode agrees but the given town
belongs to neither the locality nor the municipality of the candidate, the result is `check`
(`postcode`). That catches swapped digits that land on a real street of another town (1003 → 1030).

**Candidates.** Each gets a 0-1 score (street 45 %, number 30 %, postcode 25 %). A candidate
qualifies if its street is similar, or if postcode and town both agree. The best one gives the
position. Ties are broken by the town. Several equally good candidates more than 100 m apart are
`ambiguous` (two entrances of one building within 100 m are not).

**Searches.** (1) street, number and postcode (or town when there is no postcode); (2) if nothing
fits and a postcode was given: street, number and town (the postcode may be wrong); (3) if the
street still has no similar candidate: the same with the long words cut to 5 letters (finds
`Milchtsrasse` → `Milchstrasse`). Only when no swisstopo candidate has a similar street, MOTIS is
asked. Typically 1 request per address, 2-3 for typos and garbage.

## Status and reason codes

| status | when |
| --- | --- |
| `exact` | postcode equal, house number equal incl. suffix, street equal (type equal, typo within tolerance), no second equally good place, town consistent. `reasons` is empty. |
| `check` | something fits, not everything. Position and up to 5 candidates are given. |
| `notfound` | nothing with the street, or postcode and town, in common; garbage; empty; no street at all (postcode and town alone). No request is made for empty or street-less input. |

| reason | meaning |
| --- | --- |
| `postcode` | differs, is missing, or does not go with the given town |
| `houseNumber` | differs (also 27 vs 27a), or the register has no such number and the nearest was returned |
| `noNumber` | the input had no house number: the position is the street |
| `street` | name only similar: other type, typo beyond tolerance, or only postcode and town agree |
| `ambiguous` | several equally good candidates more than 100 m apart |
| `fallback` | the answer comes from MOTIS |

Reasons are returned in this order. If both services fail (network down) `check()` throws, so the
caller can retry instead of storing a false "not found".

## Limits

- A missing postcode is always `check` (`postcode`), even if the town is given and the match is unique.
  Use `accept-checks` for lists without postcodes.
- A wrong number that is a real number of the same street and postcode is a valid address and comes
  back `exact` at that other building. Nothing in the text can reveal it.
- Accents stripped from umlauts (`Gassli` for `Gässli`) are not found by the search service; the
  neighbour is returned as `check` (`houseNumber`).
- A street that is nonsense in a real postcode and town yields `check` (`street`) with a score below
  0.7 and a position in that town (the spec's "postcode+town in common").
- Hamlet or former municipality names that are neither locality nor municipality of the register
  entry give `check` (`postcode`).
- The register is the building address register: new buildings, farms named without street
  (`Ponte Scuro 996a.99`), and addresses outside Switzerland are not supported.
- The position is the entrance/building point of the register (a few metres), not a parcel.

## Acceptance (AN-A1)

`pnpm tsx tools/address-test/build.ts` draws the set from the **official register download**
(swisstopo "Amtliches Gebäudeadressverzeichnis", CSV on data.geo.admin.ch, 143 MB zip, every address
with LV95 coordinates): 1,000 addresses, 35 % Vaud, the rest over all cantons (weights: square root
of the canton's address count), seeded. 930 clean rows in varied formats (one line, split columns, number
first, no comma, abbreviations, upper/lower case, `CH-` prefix, accents stripped, locality or municipality as town) and
70 (7 %) with an injected error: 14 street typos, 14 missing postcodes, 14 postcodes with swapped digits,
14 house numbers not in the register, 7 numbers of another real building, 7 garbage rows. The truth file is
`tools/address-test/set/acceptance-set.json`. `pnpm tsx tools/address-test/run.ts` runs it (cached on disk:
a rerun costs no request; a fresh checkout needs about 1,000 requests; `--set=holdout` runs the second set).

| target | result (1,000 rows) | hold-out (seed 7, 400 rows, not used for tuning) |
| --- | --- | --- |
| clean returned exact within 50 m (>= 99 %) | **929 / 930 = 99.89 %** | 371 / 372 = 99.73 % |
| wrong house numbers flagged (all) | **14 / 14** | 6 / 6 |
| exact more than 500 m from the truth (none) | **0** | 0 |

Status counts (1,000 rows): exact 944, check 49, notfound 7. Typos: 14/14 found within 50 m (8 exact, 6 check);
missing postcode 14/14 check; swapped digits 14/14 check; garbage 7/7 notfound; number of another building
7/7 resolved to that building.

The only clean row not exact: `Gassli 2c, 3205 Gummenen` (accents stripped, see limits; returned `Gässli 2`, 31 m away, as check).
The hold-out miss is a real twin (`Route Suisse 6, 1166 Perroy` exists twice more than 100 m apart): `ambiguous` is right.

Speed with 4 requests in parallel: 1,000 rows in 49 s (927 requests, mean 211 ms), 400 rows in 22 s.
About 20 rows per second, so a list of 20,000 takes about 17 minutes.

## Fair use of the swisstopo service

At most 4 requests in flight (enforced inside each geocoder instance, so any number of concurrent
`check()` calls is safe), one retry after 300 ms on errors/429/5xx. Develop and test against cached or
recorded answers: unit tests use `test/fixtures/geocode/` (recorded by
`tools/address-test/record-fixtures.ts`), the acceptance runner caches under `tools/address-test/cache/`
(git-ignored together with `data/` and `out/`). Building the whole set and tuning took about 1,450 requests.
Bulk lists should be processed by a background queue, as the app does, not in the request path.
