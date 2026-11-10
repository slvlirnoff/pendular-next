# SBB icons: provenance and licence

## What these files are

About 1,060 SVG pictograms (train line labels such as IC, IR, S, EV, plus mode and utility icons) from SBB's icon CDN.
They are vendored unmodified, exactly as served, by `data/scripts/vendor-sbb-icons.ts`.

- Source: https://icons.app.sbb.ch/icons/<name>.svg
- Icon index version: 1.8.37 (see `manifest.json`)
- Fetched: 2026-11-10 (`fetchedAt` in `manifest.json`)
- Modifications: none.

## Licence (confirmed)

The icons are published by SBB as the open-source repository https://github.com/sbb-design-systems/sbb-icons, whose index page on the CDN links to it. That repository and the npm package `@sbb-esta/icons` declare `"license": "Apache-2.0"` and ship an Apache License 2.0 `LICENSE` file.

Checked on 2026-11-10:
- npm `@sbb-esta/icons` 1.8.1 (https://registry.npmjs.org/@sbb-esta/icons/-/icons-1.8.1.tgz): licence field Apache-2.0; its `LICENSE` is the Apache 2.0 text. Spot check: `icons/ev-10.svg` in the tarball is byte-identical to the file here and to the CDN copy.
- Repository `package.json` at version 1.8.38 (https://raw.githubusercontent.com/sbb-design-systems/sbb-icons/main/package.json): `"license": "Apache-2.0"`.

The npm package lags the CDN index (1.8.1 vs 1.8.37), so the licence for the exact vendored version rests on the repository file above. `LICENSE` here is the unmodified Apache 2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt. The repository has no NOTICE file.

## Brand-use terms

Apache-2.0 does not grant trademark rights. The SBB name, logo and pictograms are also subject to SBB's own brand-use terms. We could not retrieve those terms (sbb.ch refuses automated requests, and digital.sbb.ch returned no usable terms page), so they were not reviewed. The project owner has stated that their use on this site is cleared.
