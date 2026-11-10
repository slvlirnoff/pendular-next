// SBB pictogram lookup. Names are file names (without .svg) in /icons/sbb/.
// Only names present in manifest.json are ever returned.
import manifest from '../../public/icons/sbb/manifest.json' with { type: 'json' };

const LINES: ReadonlySet<string> = new Set(manifest.lines);
const ICONS: ReadonlySet<string> = new Set(manifest.icons);

/**
 * Icon file name for a timetable line, or null.
 *   { name: "IR 15" } -> "ir-15"     { name: "S3" } / "S 3" -> "s-3"
 *   { name: "RE33" } -> "re-33"      { name: "IC 1" } -> "ic-1"
 *   { name: "R" } -> "r"             { name: "ICE" } -> "ice"
 *   { name: "Bus 12" } -> null       { name: "S99999" } -> null (not in manifest)
 * `category` (e.g. "IR") is used when the name is only a number ("15").
 */
export function linePictogram(line: { name: string; category?: string }): string | null {
  const name = line.name.trim().toLowerCase();
  let m = /^([a-z]+)[\s-]*(\d{1,3})?$/.exec(name);
  let family: string | undefined;
  let num: string | undefined;
  if (m) {
    family = m[1];
    num = m[2];
  } else if (/^\d{1,3}$/.test(name) && line.category) {
    family = line.category.trim().toLowerCase();
    num = name;
  } else {
    return null;
  }
  if (!family) return null;
  const candidates = num !== undefined ? [`${family}-${Number(num)}`, family] : [family];
  // A numbered line without its own pictogram falls back to the bare family icon (e.g. "pe" for unknown PE).
  for (const c of candidates) if (LINES.has(c)) return c;
  return null;
}

export type ModeLike = 'walk' | 'bike' | 'ebike' | 'car' | 'rail' | 'bus' | 'tram' | 'metro' | 'boat' | 'funicular' | 'cableway' | (string & {});

/**
 * Icon file name for a leg mode (-small variant; swap the suffix for -medium).
 * Substitutes: ebike -> bike-profile-power-plug-small (no dedicated e-bike icon);
 * metro -> underground-vehicule-profile-small; cableway -> cable-car-profile-small
 * (gondola-profile-small and chairlift-profile are also in the SBB set).
 *   modeIcon('rail') -> "train-small"   modeIcon('foo') -> "train-small"
 */
export function modeIcon(mode: ModeLike): string {
  const pick = (n: string): string => (ICONS.has(n) ? n : 'train-small');
  switch (mode) {
    case 'walk': return pick('walk-small');
    case 'bike': return pick('bicycle-small');
    case 'ebike': return pick('bike-profile-power-plug-small');
    case 'car': return pick('car-small');
    case 'bus': return pick('bus-small');
    case 'tram': return pick('tram-small');
    case 'metro': return pick('underground-vehicule-profile-small');
    case 'boat': return pick('boat-profile-small');
    case 'funicular': return pick('funicular-profile-small');
    case 'cableway': return pick('cable-car-profile-small');
    default: return pick('train-small');
  }
}
