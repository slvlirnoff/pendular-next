# Golden commutes

A fixed set of realistic commutes (`commutes.json`, 13 base commutes plus 5 Yverdon -> Lausanne traveller variants: youth, senior,
Half Fare, 1st class, 2 days a week) that is posted to the running API, sanity-checked, diffed against a snapshot and summarised.

    pnpm tsx tools/golden/run.ts            # run, check, diff against expected.json, write REPORT.md
    pnpm tsx tools/golden/run.ts --update   # same, then rewrite expected.json from this run
    pnpm tsx tools/golden/run.ts --only=nyon-geneve,aigle-lausanne
    pnpm tsx tools/golden/run.ts --api=http://host:8787   # or PENDULAR_API; VERBOSE=1 also prints PASS lines

Needs the API (default http://127.0.0.1:8787) and MOTIS running. Commutes run one at a time (about 4 s each, about 70 s in total).

- `out/<name>.json`: raw CompareResult per commute (git-ignored).
- Sanity checks (FAIL): car option present, transit present, durations 1..300 min, yearly cost 0..60'000, cheapest product not above
  GA x1.05, products sorted, verdict ids exist, left-out codes present, no START/END in titles; and between a variant and its base:
  1st >= 2nd class, youth/senior annual Mobilis pass <= adult, Half Fare holder <= non-holder, part-timer <= full-timer; car CO2 > best transit CO2.
- `expected.json`: per commute and option kind: count, best duration, cheapest yearly cost, cheapest product, zones or tariff km.
  Differences (duration > 3 min, cost > 2 %, count, product, zones) are WARN since routing data changes weekly; a kind that disappears is FAIL.
  After an intended change, review the WARNs and run with `--update`.
- `REPORT.md`: generated table (cheapest / fastest / greenest, option counts), automatic heuristic flags, and the hand-written review in
  `judgement.md`, which is copied in on every run. Edit `judgement.md`, not REPORT.md.

Exit code 1 if any FAIL, 2 if the runner itself crashes.
