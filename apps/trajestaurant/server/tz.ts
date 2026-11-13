// Opening hours are read in local time: the server keeps the region's time (Swiss time by default)
// whatever the machine says. Imported first by server.ts, before anything creates a Date.
import { REGION } from './region.js';

process.env.TZ ??= REGION.timezone;
