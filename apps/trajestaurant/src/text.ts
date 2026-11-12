/** Lower case, no accents, single spaces: how names and searches are compared. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[’'`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The form names are searched by: folded, punctuation as spaces ("Mix-Image" → "mix image"). */
export function searchKey(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words that say what a place is rather than which one it is. */
const GENERIC = new Set(
  [
    // Places to eat and drink.
    'restaurant ristorante restaurante gasthaus gasthof wirtschaft beiz pinte cafe caffe bar pub bistro brasserie hotel auberge',
    'pizzeria pizza kebab burger burgers sushi take away takeaway snack grill trattoria osteria',
    // Shops and services: what a place is, not which one ("Bea coiffure" is not "Coiffure Sandra").
    'coiffure coiffeur coiffeuse salon friseur hair haarstudio barber barbier beaute beauty institut esthetique onglerie nails kosmetik',
    'pharmacie apotheke farmacia droguerie drogerie boulangerie backerei patisserie confiserie boucherie metzgerei fromagerie',
    'garage autogarage carrosserie auto pneus fleurs fleuriste blumen optique opticien optik bijouterie horlogerie kiosque kiosk',
    'boutique shop store magasin laden atelier studio center centre cabinet agence epicerie fitness sport sports mode',
    'cave vins vin wein librairie papeterie animalerie quincaillerie electricite sanitaire',
    // Practices and trades ("Dr. med. Anna Muster" is not "Dr. med. Peter Keller" next door).
    'dr dre med prof pd fmh docteur doctor medecin medecins praxis arztpraxis gemeinschaftspraxis gruppenpraxis zahnarztpraxis',
    'medical medicale medicaux dentaire dental zahnarzt physio physiotherapie physiotherapy therapie therapy ergotherapie',
    'osteopathie clinique klinik sante gesundheit zentrum tierarzt tierarztpraxis veterinaire',
    'elektro elektriker sanitar heizung chauffage maler malerei peinture gipserei schreinerei menuiserie zimmerei charpente',
    'holzbau bau bauunternehmung construction constructions treuhand fiduciaire immobilien immobilier regie',
    'versicherung versicherungen assurance assurances notariat anwalt anwaltskanzlei kanzlei avocat avocats etude',
    'transport transports service services partner co cie fils sohn sohne',
    // Where a place is, shared by its neighbours ("Café de la Gare", "k kiosk Bahnhof").
    'gare bahnhof stazione station buffet',
    // Words that join names.
    'la le les l du de des d the and et und zum zur chez au aux sa ag gmbh sarl s a',
    'di del della dei da il lo e am im an der die das den dem bei beim von vom en y',
    'podologie podologia pedicure fusspflege massage massagen massages studio institut',
  ].join(' ').split(' '),
);

export function nameTokens(name: string): string[] {
  return fold(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC.has(w));
}

/** Whether two names are those of one place: shared distinctive words, or one name inside the other. */
export function sameName(a: string, b: string, placeWords?: ReadonlySet<string>): boolean {
  const fa = fold(a).replace(/[^a-z0-9]+/g, ' ').trim();
  const fb = fold(b).replace(/[^a-z0-9]+/g, ' ').trim();
  if (fa === fb) return true;
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (placeWords?.size) {
    // The town is not who a place is: "Physio Langenthal" is not "Thai Time Langenthal". Names
    // that are only a kind and a town ("Pharmacie de Lucens", "Pharmacie Lucens") still compare.
    const oa = [...ta].filter((t) => !placeWords.has(t));
    const ob = [...tb].filter((t) => !placeWords.has(t));
    if (oa.length && ob.length) return overlap(new Set(oa), new Set(ob));
    if (oa.length || ob.length) return false;
  }
  if (ta.size === 0 || tb.size === 0) return false;
  return overlap(ta, tb);
}

function overlap(ta: Set<string>, tb: Set<string>): boolean {
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/**
 * Entries (food types, kinds of shops) for a search text, best first: a synonym or label equal to
 * the text, then one starting with it, then one containing it; ties keep the list order.
 */
export function rankMatches(entries: { key: string; label: string; synonyms: string[] }[], q: string): string[] {
  const text = fold(q);
  if (!text) return [];
  const scored: { key: string; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    let score = 0;
    for (const w of [fold(e.label), e.key, ...e.synonyms]) {
      if (w === text) score = Math.max(score, 3);
      else if (w.startsWith(text)) score = Math.max(score, 2);
      else if (text.length >= 3 && (w.includes(text) || w.split(/[\s&,'-]+/).some((p) => p.startsWith(text)))) score = Math.max(score, 1);
    }
    if (score) scored.push({ key: e.key, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.key);
}
