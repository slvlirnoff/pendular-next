// Opening hours are read in local time: the server keeps Swiss time whatever the machine says.
// Imported first by server.ts, before anything creates a Date.
process.env.TZ ??= 'Europe/Zurich';
