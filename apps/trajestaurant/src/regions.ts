/**
 * The editions of the site: one deployment per region, chosen with REGION (ch by default), each
 * with its own name, languages, places database, timetable and map. The server reads the region
 * from the environment and writes its id into the page, so one build of the site serves them all.
 *
 *   REGION=ch          Trajestaurant: Switzerland, in French, German, Italian and English
 *   REGION=vinnytsia   Тролейбуфет · Trolleybuffet: Vinnytsia (Ukraine), in Ukrainian and English
 *
 * The defaults (port, database, MOTIS) let both run side by side on one machine; any of them can
 * be overridden by the environment (PORT, DATABASE_URL, MOTIS_URL, MOTIS_CONFIG, VALHALLA_URL).
 */
export type RegionLang = 'fr' | 'de' | 'it' | 'en' | 'uk';
export type RegionId = 'ch' | 'vinnytsia';
/** [[west, south], [east, north]] in degrees. */
export type Box = [[number, number], [number, number]];

export interface Region {
  id: RegionId;
  /** The site's name by language; a language without one takes the first language's. */
  name: Partial<Record<RegionLang, string>>;
  /** What the site is, for search engines and link previews. */
  description: Partial<Record<RegionLang, string>>;
  /** Shown under the welcome screen. */
  domain?: string;
  /** The languages offered; the first is the default. */
  langs: RegionLang[];
  /** ISO 3166-1 code, lower case: public holidays, brands (Name Suggestion Index), foods. */
  country: string;
  /** The state or canton whose public holidays opening hours follow (opening_hours.js). */
  holidayState?: string;
  timezone: string;
  /** The map when the site opens. */
  view: Box;
  /** Where places and positions are taken (a position outside is refused). */
  area: Box;
  themeColor: string;
  /**
   * The base map's labels in the reader's language (Cyrillic in Ukrainian, transliterated in
   * English) rather than the style's Latin-and-local pairs, which double every label there.
   */
  labelsInLanguage?: boolean;
  /** Pendular's grid of residents and jobs (traffic, parking for car times): Switzerland only. */
  density: boolean;
  /** Shared cars, bikes and scooters live from sharedmobility.ch (SHAREDMOBILITY_CONTACT): Switzerland only. */
  sharedMobility: boolean;
  defaults: {
    port: number;
    /** The development site (vite), which forwards /api to the port above. */
    webPort: number;
    database: string;
    motisUrl: string;
    /** MOTIS's configuration (its timetable days), relative to the repository. */
    motisConfig: string;
  };
  /** Texts of the site that differ from the common ones (web/src/i18n.ts), by key and language. */
  strings: Record<string, Partial<Record<RegionLang, string>>>;
}

const SWITZERLAND: Box = [
  [5.95, 45.82],
  [10.49, 47.81],
];

export const REGIONS: Record<RegionId, Region> = {
  ch: {
    id: 'ch',
    name: { fr: 'Trajestaurant' },
    description: {
      fr: 'Trajestaurant : trouve où manger près de toi (pizza, burger, sushi…) et comment y aller à pied, en transports publics ou en voiture.',
      de: 'Trajestaurant: finde, wo du in deiner Nähe essen kannst (Pizza, Burger, Sushi…), und wie du hinkommst: zu Fuss, mit dem ÖV oder dem Auto.',
      it: 'Trajestaurant: trova dove mangiare vicino a te (pizza, burger, sushi…) e come arrivarci a piedi, con i mezzi pubblici o in auto.',
      en: 'Trajestaurant: find where to eat near you (pizza, burger, sushi…) and how to get there on foot, by public transport or by car.',
    },
    domain: 'trajestaurant.ch',
    langs: ['fr', 'de', 'it', 'en'],
    country: 'ch',
    holidayState: 'Vaud',
    timezone: 'Europe/Zurich',
    view: SWITZERLAND,
    area: [
      [5, 45],
      [11.5, 48.5],
    ],
    themeColor: '#d93a24',
    density: true,
    sharedMobility: true,
    defaults: { port: 8789, webPort: 5174, database: 'trajestaurant', motisUrl: 'http://127.0.0.1:8080', motisConfig: 'data/motis/config.yml' },
    strings: {},
  },
  vinnytsia: {
    id: 'vinnytsia',
    // Trolleybus + buffet: Vinnytsia is a city of trams and trolleybuses (it builds its own).
    name: { uk: 'Тролейбуфет', en: 'Trolleybuffet' },
    description: {
      uk: 'Тролейбуфет: знайди, де поїсти, магазин чи послугу поруч у Вінниці, і як туди дістатися: пішки, на велосипеді, трамваєм, тролейбусом, маршруткою чи автом.',
      en: 'Trolleybuffet: find where to eat, a shop or a service near you in Vinnytsia, and how to get there: on foot, by bike, tram, trolleybus, marshrutka or car.',
    },
    langs: ['uk', 'en'],
    country: 'ua',
    timezone: 'Europe/Kyiv',
    // The city; the places are those of the whole oblast.
    view: [
      [28.36, 49.17],
      [28.6, 49.3],
    ],
    area: [
      [27.3, 47.9],
      [30.1, 50.0],
    ],
    themeColor: '#1e5aa8',
    labelsInLanguage: true,
    density: false,
    sharedMobility: false,
    defaults: { port: 8790, webPort: 5175, database: 'trolleybuffet', motisUrl: 'http://127.0.0.1:8081', motisConfig: 'data/motis-vinnytsia/config.yml' },
    strings: {
      'search.placeholder': { en: 'Pizza, pharmacy, ATB…' },
      'picker.placeholder': { en: 'Vinnytsia, railway station, street…' },
      'sugg.brand': { en: 'Chain · {kind} · {count} in the region' },
      'credits.places': {
        uk: 'Місця © OpenStreetMap, Overture, All The Places',
        en: 'Places © OpenStreetMap, Overture, All The Places',
      },
      'credits.map': {
        uk: 'Місця © OpenStreetMap, Overture Maps Foundation, All The Places · Маршрути MOTIS · Розклади vn.rozklad.in.ua, depo.vn.ua',
        en: 'Places © OpenStreetMap, Overture Maps Foundation, All The Places · Routes MOTIS · Timetables vn.rozklad.in.ua, depo.vn.ua',
      },
    },
  },
};

export function regionOf(id: string | undefined | null): Region {
  if (!id) return REGIONS.ch;
  const r = REGIONS[id as RegionId];
  if (!r) throw new Error(`unknown region "${id}" (known: ${Object.keys(REGIONS).join(', ')})`);
  return r;
}

/** The site's name in a language. */
export const regionName = (r: Region, lang: RegionLang): string => r.name[lang] ?? r.name[r.langs[0]!] ?? Object.values(r.name)[0] ?? '';

export const inBox = (b: Box, lat: number, lon: number): boolean => lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
