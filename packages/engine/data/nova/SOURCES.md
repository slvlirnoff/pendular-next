# NOVA snapshot: source, terms, limits

Snapshot of 10.11.2026, built by `tools/nova-import/import.ts` (how to rerun: `tools/nova-import/README.md`),
read by `packages/engine/src/fares/nova.ts`. Dates and counts of the files actually in the
repository are in `manifest.json`.

## Where the data comes from

| What | Where |
| --- | --- |
| SPARQL endpoint | https://lindas.admin.ch/query (LINDAS, the Confederation's linked-data service, run by the Swiss Federal Archives) |
| Fare data | named graph `https://lindas.admin.ch/sbb/nova` |
| Stop names | named graph `https://lindas.admin.ch/sbb/didok` |
| Dataset page | https://data.opentransportdata.swiss/en/dataset/lod-pilot ("Alpha: Linked Open Data Pilot: Atlas and some NOVA prices", publisher opentransportdata.swiss, organisation Business office SKI, issued 29.11.2024) |
| Documentation | https://opentransportdata.swiss/de/cookbook/alpha-linked-open-data-versuch-mit-nova-daten-und-haltestellen/ |
| Example queries, data model | https://github.com/zazuko/opentransportdata-swiss (`nova.sparqlbook.md`, `datamodel.md`, `schema/otd-schema.ttl`) |
| Shapes | https://zazuko.github.io/opentransportdata-swiss/nova-shapes.html |

The dataset page describes it as "Some data from NOVA is made available via Linked Open Data on
LINDAS. Also information on bus stops. This is a pilot project that investigates the Linked Open
Data concept." The cookbook says the graph is rebuilt from NOVA daily; the pilot is finished and
kept running on a best-effort basis. Nothing guarantees that it stays.

## Terms of use

The dataset page gives one licence entry: "Terms of use: Terms of use opentransportdata.swiss",
linking to https://opentransportdata.swiss/en/terms-of-use/ ("General Terms and Conditions of
Use – Open data platform mobility Switzerland"; read 10.11.2026; the German version is the
binding one). The clauses that matter here, quoted:

> 1. Scope of data use. The content defined as open data is freely available in machine-readable
> format on the ODMCH. Users can access the data via opentransportdata.swiss. The data obtained
> can be processed, analysed and published, including incorporating additional data.

> 5.1. Citing sources. The URL opentransportdata.swiss must be cited as the source for raw data
> in publications and analyses that make use of ODMCH data.

> 5.2 Updating raw data. ODMCH data must be updated regularly and at the same frequency as the
> underlying raw data.

> 5.3 Authorship. Processed data and analyses must be published under the name of the data user.

> 7. Liability and guarantee. SBB accepts no liability for damage or loss of any kind caused by
> the use of the data. It provides no guarantee that the published data and links, and will be
> up to date, correct, complete, available or accurate.

> 8. Misuse. Any misuse of the data shall immediately result in the relevant data user being
> banned from using any more data.

What follows for us:

- Reuse, processing and republication are allowed. A product that shows prices or zones derived
  from this data must name **opentransportdata.swiss** as the source, and present the result as
  ours, not as official fare information.
- Clause 5.2 asks for regular updates at the frequency of the raw data. The source changes daily
  in principle but fare content moves a few times a year; the periodic import is how we meet
  this. Whether a monthly rerun satisfies the clause for a committed snapshot was not asked of
  the publisher. **Open point.**
- Clauses 2 to 4 (registration, access code, request limits) concern the platform's own
  "service-based data" behind an API key. The LINDAS endpoint needs no key and the pilot's pages
  name no limit; the import stays small all the same (159 sequential requests, 84 MB, pauses).
- LINDAS: its pages on data usage (https://lindas.admin.ch/data-usage/) state no licence for
  individual datasets. Its footer links to the Confederation's general terms
  (https://www.admin.ch/gov/en/start/terms-and-conditions.html), which answered "Access Denied"
  (403) from the build machine and were **not read**.
- Tariff documents of Alliance SwissPass (T600, T600.7, T601, T650, T657) were read for
  `COMBINED-TICKETS.md` from the copies already downloaded for `../tariffs/NATIONAL-SOURCES.md`.
  They are quoted there in short extracts; none is reproduced in the snapshot.
  The handbook the cookbook links (https://www.allianceswisspass.ch/de/asp/Downloads?download=19682,
  "NOVA auf Seite 32") redirects to a login page and was not obtained.

## What is in the source, and what the snapshot keeps

Counts in the source on 10.11.2026 (class, instances): Relation 577 343; TransportEdge 156 985
(47 258 edges between neighbouring stops with a means of transport, 109 727 "short route" stop
pairs); ZoningPriceCharacteristic 23 859; Tarifwertpreisauspraegung 6 131; PayLevel 4 735;
Relationsgebiet 3 454; Zone 3 188; Tarif 837; Preistabelle 334 (25 of them precalculated, with
prices); Anwendungsbereich 165; LocalNetwork 150; ZoningPlan 82; Alliance 35; CustomerSegment 10.

Kept: everything above. Left out: edge and relation IRIs (rebuilt from stop numbers), labels in
Italian and English, print and screen texts of pay levels, reporting codes, travel-time
tolerances, stop coordinates and other DiDok attributes, 47 zone price entries without a price.

## Known limits of the source (found while importing)

- **No validity dates anywhere.** Prices, pay levels, zones and relations carry no "valid from".
  The graph shows one state: the day's. The Mobilis prices in it on 10.11.2026 are those of
  the 2026 tariff year, not those announced for 13.12.2026 (COMPARISON.md).
- **Zone prices are not linked to anything.** A `ZoningPriceCharacteristic` has a price, a
  class, a "frequency code" and sometimes a customer segment; no property, in either direction,
  ties it to a pay level, a product or an alliance. The entries are kept, but a price cannot be
  looked up from "alliance, product, number of zones".
- **The national distance tables have no prices.** The 297 tables named T601 … and the table
  "T650 Standard KILOMETER" are empty; only tariff kilometres are published for them. One
  precalculated table, "LEX Preistabelle DV Abo" (Léman Express), happens to repeat the T650
  route-pass prices (COMPARISON.md).
- Relations exist only inside one line area; a journey over several areas has to be chained at
  shared stations (`tariffKm`). The area says nothing about the order of its stops.
- T601 (single tickets) and T650 (route passes) areas are separate copies and differ in places
  (airport surcharge). Ask `tariffKm` for the one meant.
- 500 of 33 337 stop numbers used by the fare data have no name in the DiDok graph: 364 are
  numbers of stops abroad (Germany, Italy, Austria, France), 136 are Swiss numbers.
- Zoning plans are typed (`pass`, `ticket`, `connecting` ...) by reading their names; the source
  has no such attribute. The products sold on a plan (`tarifs`) are exact.
