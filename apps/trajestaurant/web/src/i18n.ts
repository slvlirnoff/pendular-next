import { FOOD_BY_KEY } from '../../src/foods';
import { FOOD_LABELS, KIND_LABELS, SEARCH_LABELS } from '../../src/i18n/labels';
import { KIND_SEARCH_BY_KEY, kindInfo } from '../../src/kinds';
import { regionName } from '../../src/regions';
import { REGION } from './region';

/**
 * The site in the edition's languages (src/regions.ts): French (as written), German, Italian and
 * English in Switzerland; Ukrainian and English in Vinnytsia. The language comes from the link
 * (?lang=en), else the one chosen before, else the browser's, else the edition's first; changing
 * it reloads the page.
 */
export type Lang = 'fr' | 'de' | 'it' | 'en' | 'uk';
const NAMES: Record<Lang, string> = { fr: 'Français', de: 'Deutsch', it: 'Italiano', en: 'English', uk: 'Українська' };
/** The edition's languages, in its order. */
export const LANGS: { key: Lang; name: string }[] = REGION.langs.map((key) => ({ key, name: NAMES[key] }));
/** The edition's first language: the one a link without ?lang= is in. */
export const DEFAULT_LANG: Lang = REGION.langs[0]!;
const STORE = 'trajestaurant.lang';
const isLang = (v: unknown): v is Lang => typeof v === 'string' && (REGION.langs as string[]).includes(v);

function detect(): Lang {
  try {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (isLang(fromUrl)) return fromUrl;
    const stored = localStorage.getItem(STORE);
    if (isLang(stored)) return stored;
  } catch {
    // No storage (private mode): the browser's language.
  }
  for (const l of typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]) {
    const short = l.slice(0, 2).toLowerCase();
    if (isLang(short)) return short;
  }
  return DEFAULT_LANG;
}

export const LANG: Lang = typeof location === 'undefined' ? DEFAULT_LANG : detect();
/** The locale for numbers, dates and the geocoder's names. */
export const LOCALE = { fr: 'fr-CH', de: 'de-CH', it: 'it-CH', en: 'en-GB', uk: 'uk-UA' }[LANG];
if (typeof document !== 'undefined') {
  document.documentElement.lang = LANG;
  document.title = regionName(REGION, LANG);
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(STORE, l);
  } catch {
    // Kept in the link only.
  }
  const u = new URL(location.href);
  if (l === DEFAULT_LANG) u.searchParams.delete('lang');
  else u.searchParams.set('lang', l);
  location.replace(u.toString());
}

type Entry = Record<Lang, string>;
const S = {
  // Welcome
  'welcome.hello': { fr: 'Bienvenue sur', de: 'Willkommen bei', it: 'Benvenuti su', en: 'Welcome to', uk: 'Вітаємо!' },
  'welcome.lede': {
    fr: 'Trouve où manger, ton magasin ou un service près de toi, et le chemin pour y aller : à pied, à vélo, en train, en bus ou en voiture.',
    de: 'Finde, wo du essen kannst, dein Geschäft oder eine Dienstleistung in deiner Nähe, und den Weg dorthin: zu Fuss, mit dem Velo, Zug, Bus oder Auto.',
    it: 'Trova dove mangiare, il tuo negozio o un servizio vicino a te, e come arrivarci: a piedi, in bici, in treno, in bus o in auto.',
    en: 'Find where to eat, your shop or a service near you, and how to get there: on foot, by bike, by train, by bus or by car.',
    uk: 'Знайди, де поїсти, свій магазин чи послугу поруч і дорогу туди: пішки, велосипедом, трамваєм, тролейбусом, маршруткою чи машиною.',
  },
  'welcome.locating': { fr: 'Je cherche où tu es…', de: 'Ich suche, wo du bist…', it: 'Cerco dove sei…', en: 'Finding where you are…', uk: 'Шукаю, де ти…' },
  'welcome.start': { fr: 'Commencer', de: 'Los geht’s', it: 'Inizia', en: 'Start', uk: 'Почати' },
  'welcome.signin': { fr: 'Se connecter', de: 'Anmelden', it: 'Accedi', en: 'Sign in', uk: 'Увійти' },
  'welcome.soon': { fr: 'bientôt', de: 'bald', it: 'presto', en: 'soon', uk: 'скоро' },
  'welcome.soonTitle': { fr: 'Bientôt disponible', de: 'Bald verfügbar', it: 'Presto disponibile', en: 'Coming soon', uk: 'Незабаром' },
  'credits.places': { fr: 'Lieux © OpenStreetMap, Overture, All The Places', de: 'Orte © OpenStreetMap, Overture, All The Places', it: 'Luoghi © OpenStreetMap, Overture, All The Places', en: 'Places © OpenStreetMap, Overture, All The Places', uk: 'Місця © OpenStreetMap, Overture, All The Places' },
  'credits.map': {
    fr: 'Lieux © OpenStreetMap, Overture Maps Foundation, All The Places · Itinéraires MOTIS, opentransportdata.swiss',
    de: 'Orte © OpenStreetMap, Overture Maps Foundation, All The Places · Routen MOTIS, opentransportdata.swiss',
    it: 'Luoghi © OpenStreetMap, Overture Maps Foundation, All The Places · Percorsi MOTIS, opentransportdata.swiss',
    en: 'Places © OpenStreetMap, Overture Maps Foundation, All The Places · Routes MOTIS, opentransportdata.swiss',
    uk: 'Місця © OpenStreetMap, Overture Maps Foundation, All The Places · Маршрути MOTIS, vn.rozklad.in.ua, OpenStreetMap',
  },
  language: { fr: 'Langue', de: 'Sprache', it: 'Lingua', en: 'Language', uk: 'Мова' },
  // Where are you
  'picker.title': { fr: 'Où es-tu ?', de: 'Wo bist du?', it: 'Dove sei?', en: 'Where are you?', uk: 'Де ти?' },
  close: { fr: 'Fermer', de: 'Schliessen', it: 'Chiudi', en: 'Close', uk: 'Закрити' },
  'picker.locating': { fr: 'Je cherche…', de: 'Ich suche…', it: 'Cerco…', en: 'Searching…', uk: 'Шукаю…' },
  'picker.useMine': { fr: 'Utiliser ma position', de: 'Meinen Standort verwenden', it: 'Usa la mia posizione', en: 'Use my location', uk: 'Визначити, де я' },
  'picker.failed': {
    fr: 'Ta position n’est pas disponible. Écris plutôt le nom de ton village ou de ta gare.',
    de: 'Dein Standort ist nicht verfügbar. Schreib stattdessen den Namen deines Dorfs oder Bahnhofs.',
    it: 'La tua posizione non è disponibile. Scrivi invece il nome del tuo paese o della tua stazione.',
    en: 'Your location is not available. Type the name of your village or station instead.',
    uk: 'Не вдалося визначити, де ти. Напиши натомість назву свого села, вулиці чи зупинки.',
  },
  'picker.orType': { fr: 'Ou écris un lieu', de: 'Oder gib einen Ort ein', it: 'Oppure scrivi un luogo', en: 'Or type a place', uk: 'Або напиши місце' },
  'picker.placeholder': { fr: 'Lucens, gare de Moudon, rue…', de: 'Lucens, Bahnhof Moudon, Strasse…', it: 'Lucens, stazione di Moudon, via…', en: 'Lucens, Moudon station, street…', uk: 'Вінниця, вокзал, вулиця…' },
  myPosition: { fr: 'Ma position', de: 'Mein Standort', it: 'La mia posizione', en: 'My location', uk: 'Моє місцезнаходження' },
  // Search bar
  'search.region': { fr: 'Recherche', de: 'Suche', it: 'Ricerca', en: 'Search', uk: 'Пошук' },
  'search.aria': {
    fr: 'Que cherches-tu ? Une nourriture, un commerce, un service, une enseigne, une adresse ou un arrêt',
    de: 'Was suchst du? Ein Essen, ein Geschäft, eine Dienstleistung, eine Kette, eine Adresse oder eine Haltestelle',
    it: 'Cosa cerchi? Un cibo, un negozio, un servizio, una catena, un indirizzo o una fermata',
    en: 'What are you looking for? A food, a shop, a service, a chain, an address or a stop',
    uk: 'Що шукаєш? Їжу, магазин, послугу, мережу, адресу чи зупинку',
  },
  'search.placeholder': { fr: 'Pizza, pharmacie, Migros…', de: 'Pizza, Apotheke, Migros…', it: 'Pizza, farmacia, Migros…', en: 'Pizza, pharmacy, Migros…', uk: 'Піца, аптека, АТБ…' },
  clear: { fr: 'Effacer', de: 'Löschen', it: 'Cancella', en: 'Clear', uk: 'Очистити' },
  'here.change': { fr: 'changer', de: 'ändern', it: 'cambia', en: 'change', uk: 'змінити' },
  suggestions: { fr: 'Suggestions', de: 'Vorschläge', it: 'Suggerimenti', en: 'Suggestions', uk: 'Підказки' },
  'sugg.food': { fr: 'Type de nourriture', de: 'Essensart', it: 'Tipo di cibo', en: 'Type of food', uk: 'Тип їжі' },
  'sugg.kind': { fr: 'Type de commerce ou de lieu', de: 'Art von Geschäft oder Ort', it: 'Tipo di negozio o di luogo', en: 'Kind of shop or place', uk: 'Тип магазину чи місця' },
  'sugg.brand': { fr: 'Enseigne · {kind} · {count} en Suisse', de: 'Kette · {kind} · {count} in der Schweiz', it: 'Catena · {kind} · {count} in Svizzera', en: 'Chain · {kind} · {count} in Switzerland', uk: 'Мережа · {kind} · {count} в області' },
  'sugg.named': { fr: 'Tous les « {name} »', de: 'Alle «{name}»', it: 'Tutti i «{name}»', en: 'All “{name}”', uk: 'Усі «{name}»' },
  'sugg.namedCount': { fr: '{count} lieux portent ce nom', de: '{count} Orte tragen diesen Namen', it: '{count} luoghi hanno questo nome', en: '{count} places have this name', uk: 'Місць із цією назвою: {count}' },
  'sugg.stop': { fr: 'Arrêt', de: 'Haltestelle', it: 'Fermata', en: 'Stop', uk: 'Зупинка' },
  'sugg.station': { fr: 'Gare', de: 'Bahnhof', it: 'Stazione', en: 'Station', uk: 'Станція' },
  'sugg.departures': { fr: 'départs', de: 'Abfahrten', it: 'partenze', en: 'departures', uk: 'відправлення' },
  'sugg.place': { fr: 'Lieu', de: 'Ort', it: 'Luogo', en: 'Place', uk: 'Місце' },
  'sugg.address': { fr: 'Adresse', de: 'Adresse', it: 'Indirizzo', en: 'Address', uk: 'Адреса' },
  // Shortcut rows
  'row.food': { fr: 'Manger', de: 'Essen', it: 'Mangiare', en: 'Eat', uk: 'Поїсти' },
  'row.shop': { fr: 'Commerces', de: 'Geschäfte', it: 'Negozi', en: 'Shops', uk: 'Магазини' },
  'row.health': { fr: 'Santé', de: 'Gesundheit', it: 'Salute', en: 'Health', uk: "Здоров'я" },
  'row.service': { fr: 'Services', de: 'Dienste', it: 'Servizi', en: 'Services', uk: 'Послуги' },
  'row.brand': { fr: 'Enseignes', de: 'Ketten', it: 'Catene', en: 'Chains', uk: 'Мережі' },
  'chips.fold': { fr: '{title} : replier', de: '{title}: einklappen', it: '{title}: chiudi', en: '{title}: fold', uk: '{title}: згорнути' },
  'chips.all': { fr: '{title} : voir les {n}', de: '{title}: alle {n} zeigen', it: '{title}: vedi tutti i {n}', en: '{title}: show all {n}', uk: '{title}: показати всі {n}' },
  'chips.more': { fr: 'Voir les {n} autres : {title}', de: 'Die {n} weiteren zeigen: {title}', it: 'Vedi gli altri {n}: {title}', en: 'Show the {n} others: {title}', uk: 'Показати ще {n}: {title}' },
  // Results
  'sort.by': { fr: 'Trier par', de: 'Sortieren nach', it: 'Ordina per', en: 'Sort by', uk: 'Сортувати за' },
  'sort.best': { fr: 'Le plus rapide', de: 'Am schnellsten', it: 'Il più veloce', en: 'Quickest', uk: 'Найшвидше' },
  'sort.walk': { fr: 'À pied, ou en transports publics quand c’est trop loin', de: 'Zu Fuss, oder mit dem ÖV, wenn es zu weit ist', it: 'A piedi, o con i trasporti pubblici quando è troppo lontano', en: 'On foot, or by public transport when it is too far', uk: 'Пішки, а якщо задалеко — громадським транспортом' },
  'sort.bike': { fr: 'À vélo, ou en transports publics quand c’est trop loin', de: 'Mit dem Velo, oder mit dem ÖV, wenn es zu weit ist', it: 'In bici, o con i trasporti pubblici quando è troppo lontano', en: 'By bike, or by public transport when it is too far', uk: 'Велосипедом, а якщо задалеко — громадським транспортом' },
  'sort.transit': { fr: 'Sans voiture : transports publics ou à pied', de: 'Ohne Auto: ÖV oder zu Fuss', it: 'Senza auto: trasporti pubblici o a piedi', en: 'Without a car: public transport or on foot', uk: 'Без машини: громадським транспортом або пішки' },
  'sort.car': { fr: 'En voiture', de: 'Mit dem Auto', it: 'In auto', en: 'By car', uk: 'Машиною' },
  'results.near': { fr: 'près de {place}', de: 'bei {place}', it: 'vicino a {place}', en: 'near {place}', uk: 'поруч: {place}' },
  'results.noHere': { fr: 'Dis-nous d’abord où tu es (📍 en haut).', de: 'Sag uns zuerst, wo du bist (📍 oben).', it: 'Prima dicci dove sei (📍 in alto).', en: 'First tell us where you are (📍 at the top).', uk: 'Спершу скажи, де ти (📍 угорі).' },
  loading: { fr: 'Chargement', de: 'Laden', it: 'Caricamento', en: 'Loading', uk: 'Завантаження' },
  'results.error': { fr: 'La recherche n’a pas marché. Réessaie dans un instant.', de: 'Die Suche hat nicht geklappt. Versuch es gleich nochmal.', it: 'La ricerca non ha funzionato. Riprova tra un attimo.', en: 'The search did not work. Try again in a moment.', uk: 'Пошук не вдався. Спробуй ще раз за хвилинку.' },
  'results.noneFood': { fr: 'Aucun restaurant de ce type à moins de 40 km.', de: 'Kein Restaurant dieser Art im Umkreis von 40 km.', it: 'Nessun ristorante di questo tipo entro 40 km.', en: 'No restaurant of this type within 40 km.', uk: 'Жодного такого закладу в радіусі 40 км.' },
  'results.none': { fr: 'Rien trouvé à moins de 250 km.', de: 'Nichts gefunden im Umkreis von 250 km.', it: 'Niente trovato entro 250 km.', en: 'Nothing found within 250 km.', uk: 'Нічого не знайдено в радіусі 250 км.' },
  'results.missing': { fr: 'Il en manque un ? Tu peux l’ajouter sur', de: 'Fehlt einer? Ergänze ihn auf', it: 'Ne manca uno? Puoi aggiungerlo su', en: 'One missing? You can add it on', uk: 'Чогось бракує? Можеш додати це на' },
  more: { fr: 'Voir plus', de: 'Mehr zeigen', it: 'Mostra altri', en: 'Show more', uk: 'Показати ще' },
  'note.typical': { fr: 'Horaire type : même jour et même heure dans l’horaire 2027.', de: 'Musterfahrplan: gleicher Tag und gleiche Zeit im Fahrplan 2027.', it: 'Orario tipo: stesso giorno e stessa ora nell’orario 2027.', en: 'Typical timetable: same day and time in the 2027 timetable.', uk: 'Типовий розклад: той самий день тижня й час у розкладі 2027 року.' },
  'note.car': { fr: 'Voiture : trafic de l’heure et temps pour se garer compris.', de: 'Auto: Verkehr dieser Stunde und Parkzeit inbegriffen.', it: 'Auto: traffico di quest’ora e tempo per parcheggiare inclusi.', en: 'Car: this hour’s traffic and the time to park included.', uk: 'Машина: із заторами цієї години та часом на паркування.' },
  tooFar: { fr: 'Trop loin pour aujourd’hui', de: 'Heute zu weit', it: 'Troppo lontano per oggi', en: 'Too far for today', uk: 'Сьогодні задалеко' },
  'cars.one': { fr: '{n} voiture', de: '{n} Auto', it: '{n} auto', en: '{n} car', uk: '{n} авто' },
  'cars.many': { fr: '{n} voitures', de: '{n} Autos', it: '{n} auto', en: '{n} cars', uk: '{n} авто' },
  'cars.none': { fr: 'aucune voiture', de: 'kein Auto', it: 'nessuna auto', en: 'no car', uk: 'немає авто' },
  'bikes.one': { fr: '{n} vélo', de: '{n} Velo', it: '{n} bici', en: '{n} bike', uk: '{n} велосипед' },
  'bikes.many': { fr: '{n} vélos', de: '{n} Velos', it: '{n} bici', en: '{n} bikes', uk: 'велосипедів: {n}' },
  'bikes.none': { fr: 'aucun vélo', de: 'kein Velo', it: 'nessuna bici', en: 'no bike', uk: 'немає велосипедів' },
  'vehicle.scooter': { fr: 'Trottinette', de: 'E-Trottinett', it: 'Monopattino', en: 'E-scooter', uk: 'Електросамокат' },
  'vehicle.bike': { fr: 'Vélo', de: 'Velo', it: 'Bici', en: 'Bike', uk: 'Велосипед' },
  'vehicle.ebike': { fr: 'Vélo électrique', de: 'E-Bike', it: 'E-bike', en: 'E-bike', uk: 'Електровелосипед' },
  'vehicle.cargo': { fr: 'Vélo cargo', de: 'Cargo-Velo', it: 'Bici cargo', en: 'Cargo bike', uk: 'Вантажний велосипед' },
  'vehicle.moped': { fr: 'Scooter', de: 'E-Roller', it: 'Scooter', en: 'Moped', uk: 'Скутер' },
  'vehicle.car': { fr: 'Voiture', de: 'Auto', it: 'Auto', en: 'Car', uk: 'Авто' },
  'vehicle.other': { fr: 'Véhicule', de: 'Fahrzeug', it: 'Veicolo', en: 'Vehicle', uk: 'Транспорт' },
  'vehicle.range': { fr: '{n} km d’autonomie', de: '{n} km Reichweite', it: '{n} km di autonomia', en: '{n} km range', uk: 'запас ходу {n} км' },
  'vehicle.book': { fr: 'à réserver dans l’app {provider}', de: 'in der {provider}-App buchen', it: 'da prenotare nell’app {provider}', en: 'book in the {provider} app', uk: 'бронюй у застосунку {provider}' },
  // Modes
  'mode.walk': { fr: 'À pied', de: 'Zu Fuss', it: 'A piedi', en: 'On foot', uk: 'Пішки' },
  'mode.bike': { fr: 'Vélo', de: 'Velo', it: 'Bici', en: 'Bike', uk: 'Велосипед' },
  'mode.transit': { fr: 'Transports publics', de: 'ÖV', it: 'Trasporti pubblici', en: 'Public transport', uk: 'Громадський транспорт' },
  'mode.car': { fr: 'Voiture', de: 'Auto', it: 'Auto', en: 'Car', uk: 'Авто' },
  'mode.sharing': { fr: 'Car sharing', de: 'Carsharing', it: 'Car sharing', en: 'Car sharing', uk: 'Каршеринг' },
  // Place card
  back: { fr: 'Retour à la liste', de: 'Zurück zur Liste', it: 'Torna alla lista', en: 'Back to the list', uk: 'Назад до списку' },
  howToGo: { fr: 'Comment y aller', de: 'Wie hinkommen', it: 'Come arrivarci', en: 'How to get there', uk: 'Як дістатися' },
  'way.loading': { fr: 'Je calcule le chemin…', de: 'Ich berechne den Weg…', it: 'Calcolo il percorso…', en: 'Working out the way…', uk: 'Прокладаю маршрут…' },
  'way.error': { fr: 'Le calcul du chemin n’a pas marché. Réessaie.', de: 'Die Wegberechnung hat nicht geklappt. Versuch es nochmal.', it: 'Il calcolo del percorso non ha funzionato. Riprova.', en: 'Working out the way did not work. Try again.', uk: 'Не вдалося прокласти маршрут. Спробуй ще раз.' },
  'way.walk': { fr: '{min} à pied · {dist}', de: '{min} zu Fuss · {dist}', it: '{min} a piedi · {dist}', en: '{min} on foot · {dist}', uk: '{min} пішки · {dist}' },
  'way.walkFar': { fr: 'Trop loin pour y aller à pied.', de: 'Zu weit zu Fuss.', it: 'Troppo lontano a piedi.', en: 'Too far to walk.', uk: 'Задалеко, щоб іти пішки.' },
  'way.bike': { fr: '{min} à vélo · {dist}', de: '{min} mit dem Velo · {dist}', it: '{min} in bici · {dist}', en: '{min} by bike · {dist}', uk: '{min} велосипедом · {dist}' },
  'way.bikeFar': { fr: 'Trop loin pour y aller à vélo.', de: 'Zu weit mit dem Velo.', it: 'Troppo lontano in bici.', en: 'Too far to cycle.', uk: 'Задалеко для велосипеда.' },
  'way.car': { fr: '{min} en voiture · {dist}', de: '{min} mit dem Auto · {dist}', it: '{min} in auto · {dist}', en: '{min} by car · {dist}', uk: '{min} машиною · {dist}' },
  'way.noCar': { fr: 'Pas de route trouvée en voiture.', de: 'Keine Route für das Auto gefunden.', it: 'Nessun percorso in auto trovato.', en: 'No road found by car.', uk: 'Дороги для машини не знайдено.' },
  'way.drive': { fr: '{min} de route', de: '{min} Fahrt', it: '{min} di guida', en: '{min} of driving', uk: '{min} у дорозі' },
  'way.traffic': { fr: ' avec le trafic de cette heure (×{f})', de: ' mit dem Verkehr dieser Stunde (×{f})', it: ' con il traffico di quest’ora (×{f})', en: ' with this hour’s traffic (×{f})', uk: ' із заторами цієї години (×{f})' },
  'way.park': { fr: '+ {n} min pour se garer et marcher jusqu’à la porte', de: '+ {n} Min. zum Parkieren und zu Fuss bis zur Tür', it: '+ {n} min per parcheggiare e arrivare alla porta', en: '+ {n} min to park and walk to the door', uk: '+ {n} хв, щоб припаркуватися й дійти до дверей' },
  'sharing.way': { fr: '{min} en car sharing · {dist}', de: '{min} mit Carsharing · {dist}', it: '{min} in car sharing · {dist}', en: '{min} by car sharing · {dist}', uk: '{min} каршерингом · {dist}' },
  'sharing.walk': { fr: 'Marcher {min} jusqu’à la station {name}', de: '{min} zu Fuss zur Station {name}', it: 'Cammina {min} fino alla stazione {name}', en: 'Walk {min} to the {name} station', uk: 'Пішки {min} до станції «{name}»' },
  'sharing.unknown': { fr: 'Voitures à réserver dans l’app', de: 'Autos in der App buchen', it: 'Auto da prenotare nell’app', en: 'Cars to book in the app', uk: 'Авто треба бронювати в застосунку' },
  'sharing.one': { fr: '{n} voiture à la station, à réserver dans l’app', de: '{n} Auto an der Station, in der App buchen', it: '{n} auto alla stazione, da prenotare nell’app', en: '{n} car at the station, to book in the app', uk: '{n} авто на станції, бронюй у застосунку' },
  'sharing.many': { fr: '{n} voitures à la station, à réserver dans l’app', de: '{n} Autos an der Station, in der App buchen', it: '{n} auto alla stazione, da prenotare nell’app', en: '{n} cars at the station, to book in the app', uk: '{n} авто на станції, бронюй у застосунку' },
  'sharing.none': { fr: 'Aucune voiture à la station pour l’instant', de: 'Zurzeit kein Auto an der Station', it: 'Nessuna auto alla stazione per ora', en: 'No car at the station right now', uk: 'Зараз на станції немає авто' },
  'sharing.trafficShort': { fr: ' avec le trafic (×{f})', de: ' mit Verkehr (×{f})', it: ' con il traffico (×{f})', en: ' with traffic (×{f})', uk: ' із заторами (×{f})' },
  'sharing.back': { fr: 'La voiture se ramène à sa station.', de: 'Das Auto wird an seine Station zurückgebracht.', it: 'L’auto va riportata alla sua stazione.', en: 'The car goes back to its station.', uk: 'Авто треба повернути на його станцію.' },
  'sharing.book': { fr: 'Réserver chez {brand}', de: 'Bei {brand} buchen', it: 'Prenota con {brand}', en: 'Book with {brand}', uk: 'Забронювати в {brand}' },
  'sharing.provider': { fr: 'le fournisseur', de: 'dem Anbieter', it: 'il fornitore', en: 'the provider', uk: 'оператора' },
  'transit.none': {
    fr: 'Pas de transports publics plus rapides que la marche dans l’heure et demie qui vient.',
    de: 'In den nächsten anderthalb Stunden kein ÖV, der schneller ist als zu Fuss.',
    it: 'Nessun trasporto pubblico più veloce che a piedi nella prossima ora e mezza.',
    en: 'No public transport quicker than walking in the next hour and a half.',
    uk: 'У найближчі півтори години громадський транспорт не швидший, ніж пішки.',
  },
  'transit.next': { fr: 'Prochains départs', de: 'Nächste Abfahrten', it: 'Prossime partenze', en: 'Next departures', uk: 'Найближчі відправлення' },
  'transit.changes': { fr: '{n} chang.', de: '{n} Umst.', it: '{n} cambi', en: '{n} change(s)', uk: 'пересадок: {n}' },
  'transit.walk': { fr: 'Marcher {min} jusqu’à {to}', de: '{min} zu Fuss bis {to}', it: 'Cammina {min} fino a {to}', en: 'Walk {min} to {to}', uk: 'Пішки {min} → {to}' },
  'transit.line': { fr: 'Ligne', de: 'Linie', it: 'Linea', en: 'Line', uk: 'Маршрут' },
  'transit.direction': { fr: 'direction {to}', de: 'Richtung {to}', it: 'direzione {to}', en: 'towards {to}', uk: 'напрямок: {to}' },
  'info.address': { fr: 'Adresse', de: 'Adresse', it: 'Indirizzo', en: 'Address', uk: 'Адреса' },
  'info.hours': { fr: 'Horaires', de: 'Öffnungszeiten', it: 'Orari', en: 'Opening hours', uk: 'Графік роботи' },
  'info.speciality': { fr: 'Spécialité', de: 'Fachgebiet', it: 'Specialità', en: 'Speciality', uk: 'Спеціалізація' },
  'hours.closed': { fr: 'Fermé', de: 'Geschlossen', it: 'Chiuso', en: 'Closed', uk: 'Зачинено' },
  'hours.allDay': { fr: '24 h/24', de: '24 Std.', it: '24 ore su 24', en: 'Open 24 hours', uk: 'Цілодобово' },
  'hours.everyDay': { fr: 'Tous les jours', de: 'Täglich', it: 'Tutti i giorni', en: 'Every day', uk: 'Щодня' },
  'hours.week': { fr: 'Horaires des 7 prochains jours (jours fériés compris).', de: 'Öffnungszeiten der nächsten 7 Tage (Feiertage inbegriffen).', it: 'Orari dei prossimi 7 giorni (festivi inclusi).', en: 'Hours of the next 7 days (holidays included).', uk: 'Графік на наступні 7 днів (зі святковими днями).' },
  'hours.appointment': { fr: 'sur rendez-vous', de: 'nach Vereinbarung', it: 'su appuntamento', en: 'by appointment', uk: 'за записом' },
  'act.call': { fr: 'Appeler', de: 'Anrufen', it: 'Chiama', en: 'Call', uk: 'Подзвонити' },
  'act.web': { fr: 'Site web', de: 'Website', it: 'Sito web', en: 'Website', uk: 'Сайт' },
  'act.mail': { fr: 'E-mail', de: 'E-Mail', it: 'E-mail', en: 'Email', uk: 'Ел. пошта' },
  'act.share': { fr: 'Partager', de: 'Teilen', it: 'Condividi', en: 'Share', uk: 'Поділитися' },
  'act.copied': { fr: 'Lien copié', de: 'Link kopiert', it: 'Link copiato', en: 'Link copied', uk: 'Посилання скопійовано' },
  'extra.takeaway': { fr: 'À l’emporter', de: 'Zum Mitnehmen', it: 'Da asporto', en: 'Takeaway', uk: 'З собою' },
  'extra.delivery': { fr: 'Livraison', de: 'Lieferung', it: 'Consegna', en: 'Delivery', uk: 'Доставка' },
  'extra.terrace': { fr: 'Terrasse', de: 'Terrasse', it: 'Terrazza', en: 'Terrace', uk: 'Тераса' },
  'extra.vegetarian': { fr: 'Végétarien', de: 'Vegetarisch', it: 'Vegetariano', en: 'Vegetarian', uk: 'Вегетаріанське' },
  'extra.vegan': { fr: 'Vegan', de: 'Vegan', it: 'Vegano', en: 'Vegan', uk: 'Веганське' },
  'extra.wheelchair': { fr: 'Accessible', de: 'Rollstuhlgängig', it: 'Accessibile', en: 'Wheelchair accessible', uk: "Безбар'єрний доступ" },
  'source.list': { fr: 'Source : {list}.', de: 'Quelle: {list}.', it: 'Fonte: {list}.', en: 'Source: {list}.', uk: 'Джерело: {list}.' },
  'source.wrong': { fr: 'Une info manque ou est fausse ?', de: 'Fehlt etwas oder ist es falsch?', it: 'Manca qualcosa o è sbagliato?', en: 'Something missing or wrong?', uk: 'Чогось бракує або щось не так?' },
  'source.fix': { fr: 'Corriger sur OpenStreetMap', de: 'Auf OpenStreetMap korrigieren', it: 'Correggi su OpenStreetMap', en: 'Fix it on OpenStreetMap', uk: 'Виправити на OpenStreetMap' },
  'source.absent': { fr: 'Absent d’OpenStreetMap :', de: 'Nicht auf OpenStreetMap:', it: 'Assente da OpenStreetMap:', en: 'Not on OpenStreetMap:', uk: 'Немає на OpenStreetMap:' },
  'source.add': { fr: 'l’ajouter', de: 'ergänzen', it: 'aggiungilo', en: 'add it', uk: 'додати' },
  // Stops
  'board.title': { fr: 'Prochains départs', de: 'Nächste Abfahrten', it: 'Prossime partenze', en: 'Next departures', uk: 'Найближчі відправлення' },
  'board.loading': { fr: 'Je cherche les prochains départs…', de: 'Ich suche die nächsten Abfahrten…', it: 'Cerco le prossime partenze…', en: 'Looking for the next departures…', uk: 'Шукаю найближчі відправлення…' },
  'board.failed': { fr: 'Les départs n’ont pas pu être chargés.', de: 'Die Abfahrten konnten nicht geladen werden.', it: 'Non è stato possibile caricare le partenze.', en: 'The departures could not be loaded.', uk: 'Не вдалося завантажити відправлення.' },
  'board.none': { fr: 'Pas de départ dans les heures qui viennent.', de: 'Keine Abfahrt in den nächsten Stunden.', it: 'Nessuna partenza nelle prossime ore.', en: 'No departure in the coming hours.', uk: 'Найближчими годинами відправлень немає.' },
  'board.track': { fr: 'Voie {n}', de: 'Gleis {n}', it: 'Binario {n}', en: 'Platform {n}', uk: 'Колія {n}' },
  'board.now': { fr: 'maintenant', de: 'jetzt', it: 'ora', en: 'now', uk: 'зараз' },
  'board.in': { fr: 'dans {min}', de: 'in {min}', it: 'tra {min}', en: 'in {min}', uk: 'через {min}' },
  'board.cancelled': { fr: 'supprimé', de: 'fällt aus', it: 'soppresso', en: 'cancelled', uk: 'скасовано' },
  // Open or closed
  'open.open': { fr: 'Ouvert', de: 'Geöffnet', it: 'Aperto', en: 'Open', uk: 'Відчинено' },
  'open.closes': { fr: 'Ouvert · ferme {when}', de: 'Geöffnet · schliesst {when}', it: 'Aperto · chiude {when}', en: 'Open · closes {when}', uk: 'Відчинено · зачиняється {when}' },
  'open.closed': { fr: 'Fermé', de: 'Geschlossen', it: 'Chiuso', en: 'Closed', uk: 'Зачинено' },
  'open.opens': { fr: 'Fermé · ouvre {when}', de: 'Geschlossen · öffnet {when}', it: 'Chiuso · apre {when}', en: 'Closed · opens {when}', uk: 'Зачинено · відчиняється {when}' },
  'open.at': { fr: 'à {time}', de: 'um {time}', it: 'alle {time}', en: 'at {time}', uk: 'о {time}' },
  'open.dayAt': { fr: '{day} à {time}', de: '{day} um {time}', it: '{day} alle {time}', en: '{day} at {time}', uk: 'о {time} ({day})' },
  'open.unknown': { fr: 'Horaires à vérifier', de: 'Öffnungszeiten prüfen', it: 'Orari da verificare', en: 'Hours to check', uk: 'Графік треба уточнити' },
  // Map
  'map.region': { fr: 'Carte', de: 'Karte', it: 'Mappa', en: 'Map', uk: 'Мапа' },
  'map.zoom': { fr: 'Zoome pour voir les lieux autour', de: 'Zoome hinein, um die Orte ringsum zu sehen', it: 'Ingrandisci per vedere i luoghi intorno', en: 'Zoom in to see the places around', uk: 'Наблизь, щоб побачити місця навколо' },
} satisfies Record<string, Entry>;

export type Key = keyof typeof S;

/** A text of the site in the current language, {name} replaced by its value. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = REGION.strings[key]?.[LANG] ?? S[key][LANG];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** A food type's name in the current language. */
export function foodLabel(key: string): string {
  return (LANG !== 'fr' ? FOOD_LABELS[key]?.[LANG] : undefined) ?? FOOD_BY_KEY.get(key)?.label ?? key;
}

/** A kind of place's name ("Pharmacie"), its key's ("Magasin") when it has none of its own. */
export function kindName(kindKey: string, kind: string): string {
  if (LANG !== 'fr') {
    const own = KIND_LABELS[`${kindKey}=${kind}`]?.[LANG] ?? KIND_LABELS[kindKey]?.[LANG];
    if (own) return own;
  }
  return kindInfo(kindKey, kind).label;
}

/** A search's name ("Médecin", "Cordonnier & clés"). */
export function searchLabel(key: string): string {
  return (LANG !== 'fr' ? SEARCH_LABELS[key]?.[LANG] : undefined) ?? KIND_SEARCH_BY_KEY.get(key)?.label ?? key;
}

/** A number as written here (1 234). */
export const count = (n: number) => n.toLocaleString(LOCALE);
