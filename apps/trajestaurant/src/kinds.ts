import { rankMatches } from './text.js';

/**
 * Kinds of places besides food: OSM key=value → pictogram and French label. Food places
 * (amenity=restaurant, fast_food…) show their food type instead (src/foods.ts).
 */
export interface KindInfo {
  emoji: string;
  label: string;
}

const KINDS: Record<string, KindInfo> = {
  // An address the geocoder found (the address card), not a place of the database.
  'address=address': { emoji: '📍', label: 'Adresse' },
  'amenity=restaurant': { emoji: '🍽️', label: 'Restaurant' },
  'amenity=fast_food': { emoji: '🍟', label: 'Fast-food' },
  'amenity=cafe': { emoji: '☕', label: 'Café' },
  'amenity=ice_cream': { emoji: '🍦', label: 'Glacier' },
  'amenity=food_court': { emoji: '🍽️', label: 'Food court' },
  'amenity=biergarten': { emoji: '🍺', label: 'Jardin à bière' },
  'amenity=pub': { emoji: '🍺', label: 'Pub' },
  'amenity=bar': { emoji: '🍸', label: 'Bar' },
  'amenity=pharmacy': { emoji: '💊', label: 'Pharmacie' },
  'amenity=fuel': { emoji: '⛽', label: 'Station-service' },
  'amenity=bank': { emoji: '🏦', label: 'Banque' },
  'amenity=post_office': { emoji: '📮', label: 'Poste' },
  'amenity=cinema': { emoji: '🎬', label: 'Cinéma' },
  'amenity=car_rental': { emoji: '🚙', label: 'Location de voitures' },
  'amenity=car_sharing': { emoji: '🔑', label: 'Car sharing' },
  'amenity=theatre': { emoji: '🎭', label: 'Théâtre' },
  'amenity=library': { emoji: '📚', label: 'Bibliothèque' },
  'amenity=marketplace': { emoji: '🧺', label: 'Marché' },
  'amenity=doctors': { emoji: '🩺', label: 'Cabinet médical' },
  'amenity=dentist': { emoji: '🦷', label: 'Dentiste' },
  'amenity=clinic': { emoji: '🏥', label: 'Clinique' },
  'amenity=hospital': { emoji: '🏥', label: 'Hôpital' },
  'amenity=veterinary': { emoji: '🐕', label: 'Vétérinaire' },
  'amenity=police': { emoji: '🚓', label: 'Police' },
  'amenity=townhall': { emoji: '🏘️', label: 'Administration communale' },
  'amenity=courthouse': { emoji: '⚖️', label: 'Tribunal' },
  'amenity=driving_school': { emoji: '🚦', label: 'Auto-école' },
  'amenity=car_wash': { emoji: '🧽', label: 'Lavage auto' },
  'amenity=vehicle_inspection': { emoji: '🚘', label: 'Contrôle technique' },
  'amenity=recycling': { emoji: '♻️', label: 'Déchetterie' },
  'amenity=atm': { emoji: '🏧', label: 'Bancomat' },
  'amenity=bureau_de_change': { emoji: '💱', label: 'Bureau de change' },
  'healthcare=physiotherapist': { emoji: '🦴', label: 'Physiothérapie' },
  'healthcare=occupational_therapist': { emoji: '✋', label: 'Ergothérapie' },
  'healthcare=speech_therapist': { emoji: '🗣️', label: 'Logopédie' },
  'healthcare=rehabilitation': { emoji: '🦽', label: 'Réadaptation' },
  'healthcare=psychotherapist': { emoji: '🧠', label: 'Psychothérapie' },
  'healthcare=psychologist': { emoji: '🧠', label: 'Psychologue' },
  'healthcare=counselling': { emoji: '💬', label: 'Consultation' },
  'healthcare=alternative': { emoji: '🌿', label: 'Médecine douce' },
  'healthcare=podiatrist': { emoji: '🦶', label: 'Podologie' },
  'healthcare=laboratory': { emoji: '🧪', label: 'Laboratoire' },
  'healthcare=midwife': { emoji: '🤰', label: 'Sage-femme' },
  'healthcare=birthing_centre': { emoji: '🤰', label: 'Maison de naissance' },
  'healthcare=audiologist': { emoji: '👂', label: 'Audiologie' },
  'healthcare=optometrist': { emoji: '👓', label: 'Optométrie' },
  'healthcare=nurse': { emoji: '💉', label: 'Soins infirmiers' },
  'healthcare=centre': { emoji: '🏥', label: 'Centre de santé' },
  'healthcare=blood_donation': { emoji: '🩸', label: 'Don du sang' },
  'craft=carpenter': { emoji: '🪚', label: 'Charpentier' },
  'craft=joiner': { emoji: '🪚', label: 'Menuisier' },
  'craft=cabinet_maker': { emoji: '🪚', label: 'Ébéniste' },
  'craft=window_construction': { emoji: '🪟', label: 'Fenêtres' },
  'craft=electrician': { emoji: '⚡', label: 'Électricien' },
  'craft=painter': { emoji: '🖌️', label: 'Peintre' },
  'craft=plumber': { emoji: '🚿', label: 'Sanitaire' },
  'craft=hvac': { emoji: '🔥', label: 'Chauffage & ventilation' },
  'craft=metal_construction': { emoji: '🔩', label: 'Construction métallique' },
  'craft=blacksmith': { emoji: '🔨', label: 'Forgeron' },
  'craft=locksmith': { emoji: '🔐', label: 'Serrurier' },
  'craft=key_cutter': { emoji: '🗝️', label: 'Clés' },
  'craft=gardener': { emoji: '🌳', label: 'Paysagiste' },
  'craft=roofer': { emoji: '🏠', label: 'Couvreur' },
  'craft=tinsmith': { emoji: '🏠', label: 'Ferblantier' },
  'craft=builder': { emoji: '🏗️', label: 'Entreprise de construction' },
  'craft=plasterer': { emoji: '🏗️', label: 'Plâtrier' },
  'craft=stonemason': { emoji: '🪨', label: 'Tailleur de pierre' },
  'craft=tiler': { emoji: '🧱', label: 'Carreleur' },
  'craft=floorer': { emoji: '🧱', label: 'Poseur de sols' },
  'craft=glaziery': { emoji: '🪟', label: 'Vitrier' },
  'craft=chimney_sweeper': { emoji: '🧹', label: 'Ramoneur' },
  'craft=shoemaker': { emoji: '👞', label: 'Cordonnier' },
  'craft=tailor': { emoji: '🧵', label: 'Couture & retouches' },
  'craft=dressmaker': { emoji: '🧵', label: 'Couturière' },
  'craft=upholsterer': { emoji: '🛋️', label: 'Tapissier' },
  'craft=watchmaker': { emoji: '⌚', label: 'Horloger' },
  'craft=clockmaker': { emoji: '⌚', label: 'Horloger' },
  'craft=jeweller': { emoji: '💍', label: 'Bijoutier' },
  'craft=goldsmith': { emoji: '💍', label: 'Orfèvre' },
  'craft=photographer': { emoji: '📷', label: 'Photographe' },
  'craft=electronics_repair': { emoji: '🛠️', label: 'Réparation' },
  'craft=printer': { emoji: '🖨️', label: 'Imprimerie' },
  'craft=winery': { emoji: '🍇', label: 'Cave & vigneron' },
  'craft=brewery': { emoji: '🍺', label: 'Brasserie artisanale' },
  'craft=distillery': { emoji: '🥃', label: 'Distillerie' },
  'craft=cheese': { emoji: '🧀', label: 'Fromagerie' },
  'craft=confectionery': { emoji: '🍬', label: 'Confiserie' },
  'craft=bakery': { emoji: '🥐', label: 'Boulangerie' },
  'craft=optician': { emoji: '👓', label: 'Opticien' },
  'craft=beekeeper': { emoji: '🍯', label: 'Apiculteur' },
  'craft=handicraft': { emoji: '🧶', label: 'Artisanat' },
  'craft=pottery': { emoji: '🏺', label: 'Poterie' },
  'craft=luthier': { emoji: '🎻', label: 'Luthier' },
  'craft=cleaning': { emoji: '🧹', label: 'Nettoyage' },
  'craft=agricultural_engines': { emoji: '🚜', label: 'Machines agricoles' },
  'shop=supermarket': { emoji: '🛒', label: 'Supermarché' },
  'shop=convenience': { emoji: '🏪', label: 'Épicerie' },
  'shop=department_store': { emoji: '🏬', label: 'Grand magasin' },
  'shop=mall': { emoji: '🏬', label: 'Centre commercial' },
  'shop=country_store': { emoji: '🌾', label: 'Magasin agricole' },
  'shop=bakery': { emoji: '🥐', label: 'Boulangerie' },
  'shop=pastry': { emoji: '🍰', label: 'Pâtisserie' },
  'shop=confectionery': { emoji: '🍬', label: 'Confiserie' },
  'shop=chocolate': { emoji: '🍫', label: 'Chocolaterie' },
  'shop=butcher': { emoji: '🥩', label: 'Boucherie' },
  'shop=cheese': { emoji: '🧀', label: 'Fromagerie' },
  'shop=greengrocer': { emoji: '🥕', label: 'Primeur' },
  'shop=deli': { emoji: '🥖', label: 'Traiteur' },
  'shop=coffee': { emoji: '☕', label: 'Café (magasin)' },
  'shop=tea': { emoji: '🍵', label: 'Thé' },
  'shop=wine': { emoji: '🍷', label: 'Vins' },
  'shop=alcohol': { emoji: '🍾', label: 'Boissons' },
  'shop=beverages': { emoji: '🥤', label: 'Boissons' },
  'shop=kiosk': { emoji: '📰', label: 'Kiosque' },
  'shop=newsagent': { emoji: '📰', label: 'Kiosque' },
  'shop=tobacco': { emoji: '📰', label: 'Tabac' },
  'shop=clothes': { emoji: '👕', label: 'Vêtements' },
  'shop=fashion_accessories': { emoji: '👜', label: 'Accessoires' },
  'shop=bag': { emoji: '👜', label: 'Maroquinerie' },
  'shop=shoes': { emoji: '👟', label: 'Chaussures' },
  'shop=sports': { emoji: '⚽', label: 'Sport' },
  'shop=outdoor': { emoji: '🏔️', label: 'Outdoor' },
  'shop=bicycle': { emoji: '🚲', label: 'Vélos' },
  'shop=furniture': { emoji: '🛋️', label: 'Meubles' },
  'shop=interior_decoration': { emoji: '🖼️', label: 'Décoration' },
  'shop=houseware': { emoji: '🧹', label: 'Articles ménagers' },
  'shop=kitchen': { emoji: '🚰', label: 'Cuisines' },
  'shop=carpet': { emoji: '🧶', label: 'Tapis' },
  'shop=household_linen': { emoji: '🛏️', label: 'Linge de maison' },
  'shop=bed': { emoji: '🛏️', label: 'Literie' },
  'shop=doityourself': { emoji: '🔨', label: 'Bricolage' },
  'shop=hardware': { emoji: '🔩', label: 'Quincaillerie' },
  'shop=garden_centre': { emoji: '🌱', label: 'Jardinerie' },
  'shop=florist': { emoji: '💐', label: 'Fleuriste' },
  'shop=electronics': { emoji: '📺', label: 'Électronique' },
  'shop=computer': { emoji: '💻', label: 'Informatique' },
  'shop=mobile_phone': { emoji: '📱', label: 'Téléphonie' },
  'shop=telecommunication': { emoji: '📱', label: 'Téléphonie' },
  'shop=appliance': { emoji: '🔌', label: 'Électroménager' },
  'shop=hairdresser': { emoji: '💇', label: 'Coiffeur' },
  'shop=beauty': { emoji: '💅', label: 'Institut de beauté' },
  'shop=cosmetics': { emoji: '💄', label: 'Cosmétiques' },
  'shop=perfumery': { emoji: '🌸', label: 'Parfumerie' },
  'shop=chemist': { emoji: '🧴', label: 'Droguerie' },
  'shop=optician': { emoji: '👓', label: 'Opticien' },
  'shop=hearing_aids': { emoji: '👂', label: 'Audioprothésiste' },
  'shop=medical_supply': { emoji: '🩹', label: 'Matériel médical' },
  'shop=jewelry': { emoji: '💍', label: 'Bijouterie' },
  'shop=watches': { emoji: '⌚', label: 'Horlogerie' },
  'shop=books': { emoji: '📚', label: 'Librairie' },
  'shop=stationery': { emoji: '✏️', label: 'Papeterie' },
  'shop=toys': { emoji: '🧸', label: 'Jouets' },
  'shop=games': { emoji: '🎲', label: 'Jeux' },
  'shop=video_games': { emoji: '🎮', label: 'Jeux vidéo' },
  'shop=hobby': { emoji: '🎨', label: 'Loisirs créatifs' },
  'shop=craft': { emoji: '🎨', label: 'Bricolage créatif' },
  'shop=music': { emoji: '🎵', label: 'Musique' },
  'shop=musical_instrument': { emoji: '🎸', label: 'Instruments de musique' },
  'shop=gift': { emoji: '🎁', label: 'Cadeaux' },
  'shop=variety_store': { emoji: '🛍️', label: 'Bazar' },
  'shop=second_hand': { emoji: '🏷️', label: 'Seconde main' },
  'shop=charity': { emoji: '🏷️', label: 'Seconde main' },
  'shop=massage': { emoji: '💆', label: 'Massage' },
  'shop=pet_grooming': { emoji: '✂️', label: 'Toilettage' },
  'shop=organic': { emoji: '🌿', label: 'Magasin bio' },
  'shop=health_food': { emoji: '🌿', label: 'Diététique' },
  'shop=dairy': { emoji: '🥛', label: 'Laiterie' },
  'shop=seafood': { emoji: '🐟', label: 'Poissonnerie' },
  'shop=honey': { emoji: '🍯', label: 'Miel' },
  'shop=art': { emoji: '🎨', label: "Galerie d'art" },
  'shop=e-cigarette': { emoji: '💨', label: 'Cigarette électronique' },
  'shop=weapons': { emoji: '🎯', label: 'Armurerie' },
  'shop=costume': { emoji: '🎭', label: 'Costumes' },
  'shop=pet': { emoji: '🐾', label: 'Animalerie' },
  'shop=photo': { emoji: '📷', label: 'Photo' },
  'shop=car': { emoji: '🚗', label: 'Garage (vente)' },
  'shop=car_repair': { emoji: '🔧', label: 'Garage' },
  'shop=car_parts': { emoji: '🔧', label: 'Pièces auto' },
  'shop=tyres': { emoji: '🛞', label: 'Pneus' },
  'shop=motorcycle': { emoji: '🏍️', label: 'Motos' },
  'shop=travel_agency': { emoji: '✈️', label: 'Agence de voyage' },
  'shop=laundry': { emoji: '🧺', label: 'Laverie' },
  'shop=dry_cleaning': { emoji: '👔', label: 'Pressing' },
  'shop=copyshop': { emoji: '🖨️', label: 'Copies' },
  'shop=tattoo': { emoji: '🖋️', label: 'Tatouage' },
  'shop=funeral_directors': { emoji: '🕯️', label: 'Pompes funèbres' },
  'shop=storage_rental': { emoji: '📦', label: 'Garde-meubles' },
  'shop=pawnbroker': { emoji: '💰', label: 'Prêteur sur gage' },
  'shop=lottery': { emoji: '🎟️', label: 'Loterie' },
  'shop=farm': { emoji: '🚜', label: 'Vente à la ferme' },
  'shop=paint': { emoji: '🎨', label: 'Peinture' },
  'shop=tiles': { emoji: '🧱', label: 'Carrelage' },
  'shop=flooring': { emoji: '🧱', label: 'Revêtements de sol' },
  'shop=electrical': { emoji: '💡', label: 'Électricité' },
  'shop=lighting': { emoji: '💡', label: 'Luminaires' },
  'shop=antiques': { emoji: '🏺', label: 'Antiquités' },
  'shop=wholesale': { emoji: '📦', label: 'Grossiste' },
  'shop=truck': { emoji: '🚚', label: 'Camions' },
  'shop=nutrition_supplements': { emoji: '💪', label: 'Compléments alimentaires' },
  'shop=fabric': { emoji: '🧵', label: 'Tissus' },
  'shop=wedding': { emoji: '💍', label: 'Mariage' },
  'shop=baby_goods': { emoji: '🍼', label: 'Puériculture' },
  'shop=frame': { emoji: '🖼️', label: 'Encadrement' },
  'shop=antique': { emoji: '🏺', label: 'Antiquités' },
  'leisure=fitness_centre': { emoji: '🏋️', label: 'Fitness' },
  'leisure=sports_centre': { emoji: '🏟️', label: 'Centre sportif' },
  'leisure=bowling_alley': { emoji: '🎳', label: 'Bowling' },
  'leisure=escape_game': { emoji: '🔐', label: 'Escape game' },
  'leisure=trampoline_park': { emoji: '🤸', label: 'Trampoline' },
  'leisure=water_park': { emoji: '🌊', label: 'Parc aquatique' },
  'leisure=amusement_arcade': { emoji: '🕹️', label: 'Salle de jeux' },
  'leisure=ice_rink': { emoji: '⛸️', label: 'Patinoire' },
  'leisure=swimming_pool': { emoji: '🏊', label: 'Piscine' },
  'tourism=hotel': { emoji: '🏨', label: 'Hôtel' },
  'tourism=motel': { emoji: '🏨', label: 'Motel' },
  'tourism=hostel': { emoji: '🛏️', label: 'Auberge de jeunesse' },
  'tourism=museum': { emoji: '🏛️', label: 'Musée' },
  'tourism=zoo': { emoji: '🦁', label: 'Zoo' },
  'tourism=theme_park': { emoji: '🎢', label: "Parc d'attractions" },
  'tourism=attraction': { emoji: '⭐', label: 'Attraction' },
  'office=employment_agency': { emoji: '💼', label: 'Agence de placement' },
  'office=insurance': { emoji: '🛡️', label: 'Assurance' },
  'office=estate_agent': { emoji: '🏠', label: 'Agence immobilière' },
  'office=lawyer': { emoji: '⚖️', label: 'Avocat' },
  'office=notary': { emoji: '📜', label: 'Notaire' },
  'office=accountant': { emoji: '🧮', label: 'Fiduciaire' },
  'office=tax_advisor': { emoji: '🧮', label: 'Conseil fiscal' },
  'office=government': { emoji: '🏢', label: 'Administration' },
  'office=diplomatic': { emoji: '🛂', label: 'Ambassade & consulat' },
  'office=coworking': { emoji: '🪑', label: 'Coworking' },
};

const BY_KEY: Record<string, KindInfo> = {
  shop: { emoji: '🛍️', label: 'Magasin' },
  amenity: { emoji: '📍', label: 'Lieu' },
  leisure: { emoji: '🎯', label: 'Loisirs' },
  tourism: { emoji: '⭐', label: 'Tourisme' },
  office: { emoji: '🏢', label: 'Bureau' },
  healthcare: { emoji: '⚕️', label: 'Santé' },
  craft: { emoji: '🛠️', label: 'Artisan' },
};

export function kindInfo(kindKey: string, kind: string): KindInfo {
  return KINDS[`${kindKey}=${kind}`] ?? BY_KEY[kindKey] ?? { emoji: '📍', label: 'Lieu' };
}

/** OSM amenities that are places to eat: they get food types. */
export const FOOD_KINDS = new Set(['restaurant', 'fast_food', 'cafe', 'ice_cream', 'food_court', 'biergarten']);

/** The tags a place's kind is read from, in this order (a shop with a craft is a shop). */
export const KIND_KEYS = ['amenity', 'shop', 'healthcare', 'craft', 'leisure', 'tourism', 'office'];

/** Which tagged places are kept: shops of any kind, and these values of the other keys. */
export const KEPT: Record<string, Set<string> | 'any'> = {
  shop: 'any',
  amenity: new Set([
    ...FOOD_KINDS, 'pub', 'bar', 'pharmacy', 'fuel', 'bank', 'post_office', 'cinema', 'car_rental', 'car_sharing', 'theatre', 'library', 'marketplace',
    'doctors', 'dentist', 'clinic', 'hospital', 'veterinary', 'police', 'townhall', 'courthouse', 'driving_school', 'car_wash', 'vehicle_inspection',
    'recycling', 'atm', 'bureau_de_change',
  ]),
  healthcare: new Set(Object.keys(KINDS).filter((k) => k.startsWith('healthcare=')).map((k) => k.slice('healthcare='.length))),
  craft: new Set(Object.keys(KINDS).filter((k) => k.startsWith('craft=')).map((k) => k.slice('craft='.length))),
  leisure: new Set(['fitness_centre', 'sports_centre', 'bowling_alley', 'escape_game', 'trampoline_park', 'water_park', 'amusement_arcade', 'ice_rink', 'swimming_pool']),
  tourism: new Set(['hotel', 'motel', 'hostel', 'museum', 'zoo', 'theme_park', 'attraction']),
  office: new Set(['employment_agency', 'insurance', 'estate_agent', 'lawyer', 'notary', 'accountant', 'tax_advisor', 'government', 'diplomatic', 'coworking', 'physician', 'travel_agent']),
};

/**
 * Kinds tagged in more than one way, as the one Trajestaurant searches: a doctor tagged only
 * healthcare=doctor is amenity=doctors, office=travel_agent is shop=travel_agency.
 */
const SAME_AS: Record<string, [string, string]> = {
  'healthcare=doctor': ['amenity', 'doctors'],
  'healthcare=dentist': ['amenity', 'dentist'],
  'healthcare=clinic': ['amenity', 'clinic'],
  'healthcare=hospital': ['amenity', 'hospital'],
  'healthcare=pharmacy': ['amenity', 'pharmacy'],
  'office=physician': ['amenity', 'doctors'],
  'office=travel_agent': ['shop', 'travel_agency'],
  'healthcare=psychologist': ['healthcare', 'psychotherapist'],
};

/** The main key and value of a tagged place, when it is one Trajestaurant keeps. */
export function mainKind(tags: Record<string, string | undefined>): { kindKey: string; kind: string } | null {
  for (const key of KIND_KEYS) {
    const v = tags[key];
    if (!v) continue;
    const same = SAME_AS[`${key}=${v}`];
    if (same) return { kindKey: same[0], kind: same[1] };
    const keep = KEPT[key];
    if (!(keep === 'any' ? v !== 'vacant' && v !== 'no' : keep?.has(v))) continue;
    // Recycling: the centres one drives to (déchetteries), not the street containers.
    if (key === 'amenity' && v === 'recycling' && tags.recycling_type !== 'centre') continue;
    return { kindKey: key, kind: v };
  }
  return null;
}

/**
 * Kinds of places one can search for ("pharmacie", "coiffeur"…), each covering one or more OSM
 * kinds. Places to eat are searched by food type instead (src/foods.ts). The order is that of the
 * shortcut chips; synonyms are folded (lower case, no accents) and in French, German, Italian and
 * English.
 */
export interface KindSearch {
  key: string;
  emoji: string;
  label: string;
  synonyms: string[];
  /** OSM key=value pairs. */
  kinds: string[];
  /** The row of shortcuts it is in: shops (by default), health, other services. */
  group?: 'health' | 'service';
}

export const KIND_SEARCHES: KindSearch[] = [
  { key: 'supermarche', emoji: '🛒', label: 'Supermarché', kinds: ['shop=supermarket'], synonyms: ['supermarche', 'supermarket', 'supermarkt', 'supermercato', 'courses', 'commissions', 'alimentation', 'lebensmittel', 'grocery'] },
  { key: 'pharmacie', emoji: '💊', label: 'Pharmacie', kinds: ['amenity=pharmacy'], synonyms: ['pharmacie', 'pharmacy', 'apotheke', 'farmacia', 'medicaments'] },
  { key: 'boulangerie', emoji: '🥐', label: 'Boulangerie & pâtisserie', kinds: ['shop=bakery', 'shop=pastry', 'craft=bakery'], synonyms: ['boulangerie', 'bakery', 'backerei', 'beck', 'panetteria', 'pain', 'patisserie', 'konditorei', 'pasticceria'] },
  { key: 'coiffeur', emoji: '💇', label: 'Coiffeur', kinds: ['shop=hairdresser'], synonyms: ['coiffeur', 'coiffeuse', 'coiffure', 'salon de coiffure', 'hairdresser', 'friseur', 'coiffeursalon', 'parrucchiere', 'barbier', 'barber'] },
  { key: 'station', emoji: '⛽', label: 'Station-service', kinds: ['amenity=fuel'], synonyms: ['station service', 'station-service', 'essence', 'benzine', 'carburant', 'diesel', 'fuel', 'tankstelle', 'benzin', 'benzina', 'distributore'] },
  { key: 'poste', emoji: '📮', label: 'Poste', kinds: ['amenity=post_office'], synonyms: ['poste', 'la poste', 'bureau de poste', 'post', 'postoffice', 'posta', 'colis'] },
  { key: 'banque', emoji: '🏦', label: 'Banque', kinds: ['amenity=bank'], synonyms: ['banque', 'bank', 'banca', 'agence bancaire'] },
  { key: 'kiosque', emoji: '📰', label: 'Kiosque & tabac', kinds: ['shop=kiosk', 'shop=newsagent', 'shop=tobacco'], synonyms: ['kiosque', 'kiosk', 'chiosco', 'journaux', 'tabac', 'presse', 'zeitungen', 'tabak'] },
  { key: 'epicerie', emoji: '🏪', label: 'Épicerie', kinds: ['shop=convenience', 'shop=country_store', 'shop=farm', 'shop=greengrocer', 'shop=deli', 'shop=organic', 'shop=health_food', 'shop=seafood', 'shop=honey', 'craft=beekeeper'], synonyms: ['epicerie', 'depanneur', 'dorfladen', 'convenience', 'alimentari', 'primeur', 'fruits et legumes', 'vente a la ferme', 'hofladen', 'traiteur', 'bio', 'magasin bio', 'bioladen', 'poissonnerie', 'miel'] },
  { key: 'fitness', emoji: '🏋️', label: 'Fitness', kinds: ['leisure=fitness_centre'], synonyms: ['fitness', 'gym', 'salle de sport', 'musculation', 'fitnesscenter', 'palestra', 'crossfit'] },
  { key: 'vetements', emoji: '👕', label: 'Vêtements', kinds: ['shop=clothes', 'shop=fashion_accessories', 'shop=bag'], synonyms: ['vetements', 'habits', 'mode', 'boutique', 'clothes', 'fashion', 'kleider', 'mode', 'abbigliamento'] },
  { key: 'chaussures', emoji: '👟', label: 'Chaussures', kinds: ['shop=shoes'], synonyms: ['chaussures', 'baskets', 'shoes', 'sneakers', 'schuhe', 'scarpe'] },
  { key: 'sport', emoji: '⚽', label: 'Articles de sport', kinds: ['shop=sports', 'shop=outdoor'], synonyms: ['sport', 'sports', 'articles de sport', 'ski', 'outdoor', 'sportgeschaft', 'randonnee'] },
  { key: 'velo', emoji: '🚲', label: 'Vélos', kinds: ['shop=bicycle'], synonyms: ['velo', 'velos', 'bike', 'bicycle', 'fahrrad', 'bicicletta', 'cycles'] },
  { key: 'electronique', emoji: '📺', label: 'Électronique & informatique', kinds: ['shop=electronics', 'shop=computer', 'shop=appliance'], synonyms: ['electronique', 'electronics', 'elektronik', 'informatique', 'ordinateur', 'computer', 'tv', 'electromenager', 'elettronica'] },
  { key: 'telephone', emoji: '📱', label: 'Téléphonie', kinds: ['shop=mobile_phone', 'shop=telecommunication'], synonyms: ['telephone', 'telephonie', 'portable', 'natel', 'handy', 'smartphone', 'mobile', 'cellulare'] },
  { key: 'meubles', emoji: '🛋️', label: 'Meubles & déco', kinds: ['shop=furniture', 'shop=interior_decoration', 'shop=bed', 'shop=houseware', 'shop=kitchen', 'shop=lighting', 'shop=carpet', 'shop=household_linen'], synonyms: ['meubles', 'mobilier', 'deco', 'decoration', 'furniture', 'mobel', 'mobili', 'literie', 'cuisine', 'cuisines', 'vaisselle', 'luminaires', 'tapis', 'linge de maison', 'articles menagers', 'haushalt'] },
  { key: 'bricolage', emoji: '🔨', label: 'Bricolage', kinds: ['shop=doityourself', 'shop=hardware', 'shop=paint'], synonyms: ['bricolage', 'brico', 'quincaillerie', 'outils', 'do it yourself', 'diy', 'baumarkt', 'hardware', 'ferramenta', 'peinture'] },
  { key: 'jardinerie', emoji: '🌱', label: 'Jardinerie', kinds: ['shop=garden_centre'], synonyms: ['jardinerie', 'jardin', 'plantes', 'garden centre', 'gartencenter', 'pepiniere', 'giardinaggio'] },
  { key: 'fleuriste', emoji: '💐', label: 'Fleuriste', kinds: ['shop=florist'], synonyms: ['fleuriste', 'fleurs', 'bouquet', 'florist', 'blumen', 'fiori', 'fioraio'] },
  { key: 'librairie', emoji: '📚', label: 'Librairie & papeterie', kinds: ['shop=books', 'shop=stationery'], synonyms: ['librairie', 'livres', 'livre', 'books', 'buchhandlung', 'bucher', 'libreria', 'papeterie', 'bd', 'manga'] },
  { key: 'jouets', emoji: '🧸', label: 'Jouets & jeux', kinds: ['shop=toys', 'shop=games', 'shop=video_games', 'shop=hobby', 'shop=craft'], synonyms: ['jouets', 'jeux', 'jeux video', 'toys', 'games', 'spielwaren', 'spielzeug', 'giocattoli', 'lego', 'loisirs creatifs', 'bricolage creatif'] },
  { key: 'animalerie', emoji: '🐾', label: 'Animalerie', kinds: ['shop=pet', 'shop=pet_grooming'], synonyms: ['animalerie', 'animaux', 'pet', 'pet shop', 'zoohandlung', 'tierbedarf', 'chien', 'chat', 'toilettage', 'hundesalon'] },
  { key: 'opticien', emoji: '👓', label: 'Opticien', kinds: ['shop=optician', 'craft=optician', 'healthcare=optometrist'], synonyms: ['opticien', 'lunettes', 'lentilles', 'optician', 'optiker', 'ottico', 'brille'] },
  { key: 'beaute', emoji: '💅', label: 'Beauté & cosmétiques', kinds: ['shop=beauty', 'shop=cosmetics', 'shop=perfumery'], synonyms: ['beaute', 'institut de beaute', 'esthetique', 'estheticienne', 'onglerie', 'ongles', 'nails', 'beauty', 'kosmetik', 'cosmetiques', 'maquillage', 'parfum', 'parfumerie'] },
  { key: 'droguerie', emoji: '🧴', label: 'Droguerie', kinds: ['shop=chemist'], synonyms: ['droguerie', 'drogerie', 'drugstore', 'drogheria'] },
  { key: 'bijouterie', emoji: '💍', label: 'Bijouterie & horlogerie', kinds: ['shop=jewelry', 'shop=watches', 'craft=watchmaker', 'craft=clockmaker', 'craft=jeweller', 'craft=goldsmith'], synonyms: ['bijouterie', 'bijoux', 'montres', 'horlogerie', 'horloger', 'reparation montre', 'jewelry', 'schmuck', 'uhren', 'uhrmacher', 'goldschmied', 'gioielleria', 'orologi', 'orologiaio'] },
  { key: 'boucherie', emoji: '🥩', label: 'Boucherie', kinds: ['shop=butcher'], synonyms: ['boucherie', 'boucher', 'charcuterie', 'butcher', 'metzgerei', 'metzger', 'macelleria'] },
  { key: 'fromagerie', emoji: '🧀', label: 'Fromagerie & laiterie', kinds: ['shop=cheese', 'shop=dairy', 'craft=cheese'], synonyms: ['fromagerie', 'fromager', 'laiterie', 'kaserei', 'molkerei', 'latteria', 'cheese shop'] },
  { key: 'chocolatier', emoji: '🍫', label: 'Chocolatier & confiserie', kinds: ['shop=chocolate', 'shop=confectionery', 'craft=confectionery'], synonyms: ['chocolatier', 'chocolaterie', 'confiserie', 'bonbons', 'pralines', 'schokolade', 'cioccolato'] },
  { key: 'cave', emoji: '🍷', label: 'Vins & boissons', kinds: ['shop=wine', 'shop=alcohol', 'shop=beverages', 'craft=winery', 'craft=brewery', 'craft=distillery'], synonyms: ['cave', 'vin', 'vins', 'wine', 'wein', 'vino', 'boissons', 'getranke', 'biere', 'bieres', 'spiritueux', 'vigneron', 'encaveur', 'domaine viticole', 'degustation', 'weingut', 'cantina', 'brauerei', 'microbrasserie', 'distillerie'] },
  { key: 'grand-magasin', emoji: '🏬', label: 'Grands magasins & centres commerciaux', kinds: ['shop=department_store', 'shop=mall'], synonyms: ['grand magasin', 'grands magasins', 'centre commercial', 'mall', 'shopping', 'einkaufszentrum', 'warenhaus', 'centro commerciale'] },
  { key: 'bazar', emoji: '🛍️', label: 'Bazar & cadeaux', kinds: ['shop=variety_store', 'shop=gift'], synonyms: ['bazar', 'discount', 'cadeau', 'cadeaux', 'souvenirs', 'gift', 'geschenke', 'regali'] },
  { key: 'seconde-main', emoji: '🏷️', label: 'Seconde main', kinds: ['shop=second_hand', 'shop=charity', 'shop=antiques', 'shop=antique'], synonyms: ['seconde main', 'occasion', 'brocante', 'troc', 'second hand', 'secondhand', 'brockenhaus', 'antiquites', 'vintage'] },
  { key: 'musique', emoji: '🎸', label: 'Musique', kinds: ['shop=music', 'shop=musical_instrument'], synonyms: ['musique', 'instruments', 'instrument de musique', 'music', 'musik', 'guitare', 'piano', 'disques'] },
  { key: 'garage', emoji: '🔧', label: 'Garage', kinds: ['shop=car_repair', 'shop=car', 'shop=tyres', 'shop=car_parts'], synonyms: ['garage', 'mecanicien', 'carrosserie', 'voiture', 'auto', 'pneus', 'autogarage', 'werkstatt', 'officina', 'concessionnaire'] },
  { key: 'laverie', emoji: '🧺', label: 'Laverie & pressing', kinds: ['shop=laundry', 'shop=dry_cleaning'], synonyms: ['laverie', 'lavoir', 'pressing', 'nettoyage a sec', 'laundry', 'waschsalon', 'reinigung', 'lavanderia'] },
  { key: 'voyage', emoji: '✈️', label: 'Agence de voyage', kinds: ['shop=travel_agency'], synonyms: ['agence de voyage', 'agence de voyages', 'voyage', 'voyages', 'vacances', 'reiseburo', 'reisebuero', 'agenzia viaggi', 'travel agency'] },
    { key: 'bar', emoji: '🍸', label: 'Bar & pub', kinds: ['amenity=bar', 'amenity=pub'], synonyms: ['bar', 'bars', 'pub', 'apero', 'cocktail', 'kneipe', 'birreria'] },
  { key: 'cinema', emoji: '🎬', label: 'Cinéma', kinds: ['amenity=cinema'], synonyms: ['cinema', 'cine', 'film', 'kino', 'movies'] },
  { key: 'theatre', emoji: '🎭', label: 'Théâtre', kinds: ['amenity=theatre'], synonyms: ['theatre', 'spectacle', 'theater', 'teatro'] },
  { key: 'piscine', emoji: '🏊', label: 'Piscine', kinds: ['leisure=swimming_pool', 'leisure=water_park'], synonyms: ['piscine', 'bains', 'nager', 'swimming pool', 'schwimmbad', 'hallenbad', 'freibad', 'piscina', 'parc aquatique'] },
  { key: 'patinoire', emoji: '⛸️', label: 'Patinoire', kinds: ['leisure=ice_rink'], synonyms: ['patinoire', 'patin', 'eisbahn', 'ice rink', 'pista di ghiaccio'] },
  { key: 'sorties', emoji: '🎳', label: 'Bowling & jeux', kinds: ['leisure=bowling_alley', 'leisure=escape_game', 'leisure=trampoline_park', 'leisure=amusement_arcade'], synonyms: ['bowling', 'escape game', 'escape room', 'trampoline', 'laser game', 'arcade', 'salle de jeux', 'sortie'] },
  { key: 'parc', emoji: '🎢', label: "Zoo & parc d'attractions", kinds: ['tourism=zoo', 'tourism=theme_park'], synonyms: ['zoo', 'parc animalier', 'tierpark', "parc d'attractions", 'parc d attractions', 'luna park', 'freizeitpark', 'manege'] },
  { key: 'musee', emoji: '🏛️', label: 'Musée', kinds: ['tourism=museum'], synonyms: ['musee', 'museum', 'museo', 'exposition', 'expo'] },
  { key: 'hotel', emoji: '🏨', label: 'Hôtel', kinds: ['tourism=hotel', 'tourism=motel', 'tourism=hostel'], synonyms: ['hotel', 'hotels', 'motel', 'auberge', 'auberge de jeunesse', 'hostel', 'dormir', 'nuit', 'albergo', 'jugendherberge'] },
  { key: 'bibliotheque', emoji: '📚', label: 'Bibliothèque', kinds: ['amenity=library'], synonyms: ['bibliotheque', 'library', 'bibliothek', 'biblioteca', 'ludotheque'] },
  { key: 'marche', emoji: '🧺', label: 'Marché', kinds: ['amenity=marketplace'], synonyms: ['marche', 'market', 'markt', 'mercato', 'marche paysan'] },
  { key: 'car-sharing', emoji: '🔑', label: 'Car sharing', kinds: ['amenity=car_sharing'], synonyms: ['car sharing', 'carsharing', 'autopartage', 'voiture partagee', 'voitures partagees', 'partage de voiture', 'mobility', 'auto teilen', 'auto in condivisione', '2em', 'sponti'] },
  { key: 'location-voiture', emoji: '🚙', label: 'Location de voitures', kinds: ['amenity=car_rental'], synonyms: ['location de voiture', 'location voiture', 'louer une voiture', 'car rental', 'autovermietung', 'noleggio auto'] },

  // Health.
  { group: 'health', key: 'medecin', emoji: '🩺', label: 'Médecin', kinds: ['amenity=doctors', 'amenity=clinic'], synonyms: ['medecin', 'medecins', 'docteur', 'cabinet medical', 'generaliste', 'medecin de famille', 'pediatre', 'gynecologue', 'dermatologue', 'ophtalmologue', 'cardiologue', 'doctor', 'arzt', 'arztin', 'arztpraxis', 'hausarzt', 'kinderarzt', 'medico', 'pediatra', 'permanence', 'clinique', 'klinik', 'clinica'] },
  { group: 'health', key: 'dentiste', emoji: '🦷', label: 'Dentiste', kinds: ['amenity=dentist'], synonyms: ['dentiste', 'dentistes', 'dents', 'orthodontiste', 'hygieniste dentaire', 'dentist', 'zahnarzt', 'zahnarztin', 'kieferorthopade', 'dentista'] },
  { group: 'health', key: 'veterinaire', emoji: '🐕', label: 'Vétérinaire', kinds: ['amenity=veterinary'], synonyms: ['veterinaire', 'veto', 'vet', 'clinique veterinaire', 'tierarzt', 'tierarztin', 'tierarztpraxis', 'tierklinik', 'veterinario', 'veterinarian'] },
  { group: 'health', key: 'hopital', emoji: '🏥', label: 'Hôpital & urgences', kinds: ['amenity=hospital'], synonyms: ['hopital', 'hopitaux', 'urgences', 'urgence', 'maternite', 'spital', 'krankenhaus', 'notfall', 'notaufnahme', 'ospedale', 'pronto soccorso', 'hospital', 'emergency'] },
  { group: 'health', key: 'physio', emoji: '🦴', label: 'Physio, ergo & logopédie', kinds: ['healthcare=physiotherapist', 'healthcare=occupational_therapist', 'healthcare=speech_therapist', 'healthcare=rehabilitation'], synonyms: ['physio', 'physiotherapie', 'physiotherapeute', 'kine', 'kinesitherapeute', 'reeducation', 'physiotherapy', 'physiotherapeut', 'fisioterapia', 'fisioterapista', 'ergotherapie', 'ergo', 'ergotherapeute', 'logopedie', 'logopediste', 'logopadie', 'logopedista'] },
  { group: 'health', key: 'psy', emoji: '🧠', label: 'Psychologue & psychothérapeute', kinds: ['healthcare=psychotherapist', 'healthcare=counselling'], synonyms: ['psy', 'psychologue', 'psychotherapeute', 'psychotherapie', 'psychiatre', 'therapeute', 'psychologe', 'psychotherapeut', 'psychiater', 'psicologo', 'psicoterapeuta'] },
  { group: 'health', key: 'medecines-douces', emoji: '🌿', label: 'Médecines douces & massage', kinds: ['healthcare=alternative', 'shop=massage'], synonyms: ['medecine douce', 'medecines douces', 'osteopathe', 'osteo', 'osteopathie', 'naturopathe', 'naturopathie', 'acupuncture', 'homeopathe', 'homeopathie', 'chiropraticien', 'chiropractor', 'reflexologie', 'shiatsu', 'kinesiologie', 'massage', 'massages', 'masseur', 'heilpraktiker', 'naturheilkunde', 'komplementarmedizin', 'agopuntura'] },
  { group: 'health', key: 'podologue', emoji: '🦶', label: 'Podologue', kinds: ['healthcare=podiatrist'], synonyms: ['podologue', 'podologie', 'pedicure', 'pieds', 'podologe', 'fusspflege', 'podologo'] },
  { group: 'health', key: 'laboratoire', emoji: '🧪', label: "Laboratoire d'analyses", kinds: ['healthcare=laboratory'], synonyms: ['laboratoire', 'labo', 'analyses', 'analyses medicales', 'prise de sang', 'labor', 'laboratorio'] },
  { group: 'health', key: 'sage-femme', emoji: '🤰', label: 'Sage-femme', kinds: ['healthcare=midwife', 'healthcare=birthing_centre'], synonyms: ['sage femme', 'sages femmes', 'maison de naissance', 'accouchement', 'hebamme', 'geburtshaus', 'levatrice', 'ostetrica'] },

  // Services.
  { group: 'service', key: 'bancomat', emoji: '🏧', label: 'Bancomat', kinds: ['amenity=atm'], synonyms: ['bancomat', 'distributeur', 'distributeur de billets', 'atm', 'cash', 'retirer de l argent', 'geldautomat', 'postomat', 'cashpoint'] },
  { group: 'service', key: 'commune', emoji: '🏘️', label: 'Administration & commune', kinds: ['amenity=townhall', 'office=government'], synonyms: ['commune', 'administration communale', 'administration', 'mairie', 'hotel de ville', 'maison de commune', 'greffe', 'controle des habitants', 'bureau des etrangers', 'gemeinde', 'gemeindeverwaltung', 'gemeindehaus', 'rathaus', 'stadthaus', 'einwohnerkontrolle', 'einwohnerdienste', 'municipio', 'comune', 'cancelleria'] },
  { group: 'service', key: 'dechetterie', emoji: '♻️', label: 'Déchetterie', kinds: ['amenity=recycling'], synonyms: ['dechetterie', 'decheterie', 'dechets', 'deposito', 'centre de tri', 'recyclage', 'entsorgung', 'entsorgungsstelle', 'recyclinghof', 'werkhof', 'sammelstelle', 'ecocentre', 'discarica', 'centro di raccolta'] },
  { group: 'service', key: 'police', emoji: '🚓', label: 'Police', kinds: ['amenity=police'], synonyms: ['police', 'gendarmerie', 'poste de police', 'commissariat', 'polizei', 'polizeiposten', 'polizia'] },
  { group: 'service', key: 'lavage', emoji: '🧽', label: 'Lavage auto', kinds: ['amenity=car_wash'], synonyms: ['lavage', 'lavage auto', 'laver la voiture', 'station de lavage', 'car wash', 'carwash', 'waschanlage', 'autowaschanlage', 'waschstrasse', 'autolavaggio'] },
  { group: 'service', key: 'cordonnier', emoji: '👞', label: 'Cordonnier & clés', kinds: ['craft=shoemaker', 'craft=key_cutter'], synonyms: ['cordonnier', 'cordonnerie', 'cles', 'double de cle', 'double de cles', 'reparation chaussures', 'schuhmacher', 'schuhreparatur', 'schlussel', 'schlusseldienst', 'calzolaio', 'chiavi'] },
  { group: 'service', key: 'couture', emoji: '🧵', label: 'Couture & retouches', kinds: ['craft=tailor', 'craft=dressmaker', 'craft=upholsterer'], synonyms: ['couture', 'couturiere', 'couturier', 'retouches', 'retouche', 'tailleur', 'tapissier', 'schneider', 'schneiderin', 'schneiderei', 'anderungsschneiderei', 'sarta', 'sarto', 'sartoria'] },
  { group: 'service', key: 'photo', emoji: '📷', label: 'Photo & photographe', kinds: ['shop=photo', 'craft=photographer'], synonyms: ['photo', 'photos', 'photographe', 'photo d identite', 'photo passeport', 'studio photo', 'fotograf', 'passfoto', 'fotografo'] },
  { group: 'service', key: 'reparation', emoji: '🛠️', label: 'Réparation (téléphone, ordinateur)', kinds: ['craft=electronics_repair'], synonyms: ['reparation', 'reparation telephone', 'reparation natel', 'reparation ordinateur', 'reparation smartphone', 'ecran casse', 'reparatur', 'handy reparatur', 'riparazione'] },
  { group: 'service', key: 'imprimerie', emoji: '🖨️', label: 'Imprimerie & copies', kinds: ['craft=printer', 'shop=copyshop'], synonyms: ['imprimerie', 'impression', 'imprimer', 'copies', 'photocopies', 'druckerei', 'kopien', 'tipografia', 'copisteria'] },
  { group: 'service', key: 'auto-ecole', emoji: '🚦', label: 'Auto-école', kinds: ['amenity=driving_school'], synonyms: ['auto ecole', 'autoecole', 'permis de conduire', 'lecons de conduite', 'moniteur de conduite', 'fahrschule', 'fahrlehrer', 'scuola guida', 'driving school'] },
  { group: 'service', key: 'controle-technique', emoji: '🚘', label: 'Contrôle technique', kinds: ['amenity=vehicle_inspection'], synonyms: ['controle technique', 'expertise', 'expertise auto', 'service des automobiles', 'plaques', 'mfk', 'strassenverkehrsamt', 'motorfahrzeugkontrolle', 'collaudo'] },
  { group: 'service', key: 'avocat', emoji: '⚖️', label: 'Avocat & notaire', kinds: ['office=lawyer', 'office=notary'], synonyms: ['avocat', 'avocate', 'avocats', 'notaire', 'notaires', 'juriste', 'conseil juridique', 'anwalt', 'anwaltin', 'rechtsanwalt', 'notar', 'notariat', 'avvocato', 'notaio', 'lawyer'] },
  { group: 'service', key: 'fiduciaire', emoji: '🧮', label: 'Fiduciaire & impôts', kinds: ['office=accountant', 'office=tax_advisor'], synonyms: ['fiduciaire', 'comptable', 'comptabilite', 'impots', 'declaration d impots', 'treuhand', 'treuhander', 'treuhandburo', 'steuerberater', 'steuererklarung', 'buchhaltung', 'fiduciaria', 'contabile'] },
  { group: 'service', key: 'assurance', emoji: '🛡️', label: 'Assurance', kinds: ['office=insurance'], synonyms: ['assurance', 'assurances', 'assurance maladie', 'caisse maladie', 'versicherung', 'krankenkasse', 'assicurazione', 'cassa malati'] },
  { group: 'service', key: 'immobilier', emoji: '🏠', label: 'Agence immobilière', kinds: ['office=estate_agent'], synonyms: ['immobilier', 'agence immobiliere', 'regie', 'gerance', 'location appartement', 'immobilien', 'liegenschaftsverwaltung', 'immobiliare'] },
  { group: 'service', key: 'emploi', emoji: '💼', label: 'Emploi & placement', kinds: ['office=employment_agency'], synonyms: ['emploi', 'travail', 'job', 'interim', 'placement', 'agence de placement', 'agence d emploi', 'orp', 'rav', 'temporaire', 'stellenvermittlung', 'personalvermittlung', 'lavoro'] },
  { group: 'service', key: 'consulat', emoji: '🛂', label: 'Ambassade & consulat', kinds: ['office=diplomatic'], synonyms: ['ambassade', 'consulat', 'embassy', 'consulate', 'botschaft', 'konsulat', 'ambasciata', 'consolato'] },
  { group: 'service', key: 'coworking', emoji: '🪑', label: 'Coworking', kinds: ['office=coworking'], synonyms: ['coworking', 'co working', 'espace de travail', 'bureau partage'] },
  { group: 'service', key: 'pompes-funebres', emoji: '🕯️', label: 'Pompes funèbres', kinds: ['shop=funeral_directors'], synonyms: ['pompes funebres', 'funerailles', 'obseques', 'enterrement', 'bestattung', 'bestatter', 'bestattungsinstitut', 'onoranze funebri'] },
  { group: 'service', key: 'electricien', emoji: '⚡', label: 'Électricien', kinds: ['craft=electrician'], synonyms: ['electricien', 'electricite', 'installateur electricien', 'elektriker', 'elektroinstallation', 'elettricista'] },
  { group: 'service', key: 'sanitaire', emoji: '🚿', label: 'Sanitaire & chauffage', kinds: ['craft=plumber', 'craft=hvac'], synonyms: ['sanitaire', 'plombier', 'plomberie', 'installateur sanitaire', 'chauffage', 'chauffagiste', 'ventilation', 'climatisation', 'sanitar', 'sanitaer', 'heizung', 'klima', 'idraulico', 'riscaldamento'] },
  { group: 'service', key: 'peintre', emoji: '🖌️', label: 'Peintre en bâtiment', kinds: ['craft=painter'], synonyms: ['peintre', 'peintre en batiment', 'gypserie peinture', 'maler', 'malerei', 'malergeschaft', 'pittore', 'imbianchino'] },
  { group: 'service', key: 'menuisier', emoji: '🪚', label: 'Menuisier & charpentier', kinds: ['craft=carpenter', 'craft=joiner', 'craft=cabinet_maker', 'craft=window_construction', 'craft=glaziery'], synonyms: ['menuisier', 'menuiserie', 'charpentier', 'charpente', 'ebeniste', 'ebenisterie', 'fenetres', 'vitrier', 'schreiner', 'schreinerei', 'zimmermann', 'zimmerei', 'holzbau', 'glaser', 'falegname', 'carpentiere'] },
  { group: 'service', key: 'maconnerie', emoji: '🧱', label: 'Maçon, carreleur & plâtrier', kinds: ['craft=builder', 'craft=plasterer', 'craft=stonemason', 'craft=tiler', 'craft=floorer'], synonyms: ['macon', 'maconnerie', 'entreprise de construction', 'construction', 'carreleur', 'carrelage', 'platrier', 'gypsier', 'tailleur de pierre', 'poseur de sols', 'maurer', 'bauunternehmung', 'bauunternehmen', 'plattenleger', 'gipser', 'muratore', 'piastrellista'] },
  { group: 'service', key: 'couvreur', emoji: '🏠', label: 'Couvreur & ferblantier', kinds: ['craft=roofer', 'craft=tinsmith'], synonyms: ['couvreur', 'toiture', 'toit', 'ferblantier', 'ferblanterie', 'dachdecker', 'bedachungen', 'spengler', 'spenglerei', 'lattoniere', 'copritetto'] },
  { group: 'service', key: 'serrurier', emoji: '🔐', label: 'Serrurier & métal', kinds: ['craft=locksmith', 'craft=metal_construction', 'craft=blacksmith'], synonyms: ['serrurier', 'serrurerie', 'construction metallique', 'forgeron', 'schlosser', 'schlosserei', 'metallbau', 'schmied', 'fabbro'] },
  { group: 'service', key: 'paysagiste', emoji: '🌳', label: 'Paysagiste & jardinier', kinds: ['craft=gardener'], synonyms: ['paysagiste', 'jardinier', 'entretien de jardin', 'gartner', 'gartenbau', 'gartenpflege', 'giardiniere'] },
  { group: 'service', key: 'ramoneur', emoji: '🧹', label: 'Ramoneur', kinds: ['craft=chimney_sweeper'], synonyms: ['ramoneur', 'ramonage', 'kaminfeger', 'spazzacamino'] },
  { group: 'service', key: 'change', emoji: '💱', label: 'Bureau de change', kinds: ['amenity=bureau_de_change'], synonyms: ['change', 'bureau de change', 'devises', 'changer de l argent', 'wechselstube', 'geldwechsel', 'cambio', 'currency exchange'] },
];

export const KIND_SEARCH_BY_KEY = new Map(KIND_SEARCHES.map((k) => [k.key, k]));

const SEARCH_OF_KIND = new Map<string, string>();
for (const k of KIND_SEARCHES) for (const x of k.kinds) if (!SEARCH_OF_KIND.has(x)) SEARCH_OF_KIND.set(x, k.key);

/** What a kind is looked for as: its search ("meubles" for shop=furniture and shop=lighting), else itself. */
export function kindGroup(kindKey: string, kind: string): string {
  return SEARCH_OF_KIND.get(`${kindKey}=${kind}`) ?? `${kindKey}=${kind}`;
}

/** Kinds of places for a search text, best first. */
export function matchKinds(q: string): string[] {
  return rankMatches(KIND_SEARCHES, q);
}
