import { regionOf } from '../src/regions.js';

/** The edition this server runs (REGION=ch|vinnytsia, Switzerland by default): src/regions.ts. */
export const REGION = regionOf(process.env.REGION);
