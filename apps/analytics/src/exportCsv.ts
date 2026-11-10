import type { RatioClass, ResultRow } from './types.js';

type Lang = 'en' | 'fr' | 'de' | 'it';

const HEADERS: Record<Lang, string[]> = {
  en: ['latitude', 'longitude', 'pt_minutes', 'pt_changes', 'pt_departures_in_window', 'pt_yearly_cost_chf', 'pt_ticket', 'boarding_stop', 'car_minutes', 'car_km', 'car_yearly_cost_chf', 'bike_minutes', 'ebike_minutes', 'walk_minutes', 'co2_pt_kg_per_year', 'co2_car_kg_per_year', 'pt_vs_car', 'error'],
  fr: ['latitude', 'longitude', 'tp_minutes', 'tp_correspondances', 'tp_departs_fenetre', 'tp_cout_annuel_chf', 'tp_titre', 'arret_montee', 'voiture_minutes', 'voiture_km', 'voiture_cout_annuel_chf', 'velo_minutes', 'velo_elec_minutes', 'marche_minutes', 'co2_tp_kg_par_an', 'co2_voiture_kg_par_an', 'tp_vs_voiture', 'erreur'],
  de: ['breitengrad', 'laengengrad', 'oev_minuten', 'oev_umstiege', 'oev_abfahrten_im_fenster', 'oev_jahreskosten_chf', 'oev_billett', 'einstiegshaltestelle', 'auto_minuten', 'auto_km', 'auto_jahreskosten_chf', 'velo_minuten', 'ebike_minuten', 'fuss_minuten', 'co2_oev_kg_pro_jahr', 'co2_auto_kg_pro_jahr', 'oev_vs_auto', 'fehler'],
  it: ['latitudine', 'longitudine', 'tp_minuti', 'tp_cambi', 'tp_partenze_nella_finestra', 'tp_costo_annuo_chf', 'tp_biglietto', 'fermata_salita', 'auto_minuti', 'auto_km', 'auto_costo_annuo_chf', 'bici_minuti', 'ebike_minuti', 'a_piedi_minuti', 'co2_tp_kg_anno', 'co2_auto_kg_anno', 'tp_vs_auto', 'errore'],
};

const ID_HEADER: Record<Lang, string> = { en: 'id', fr: 'id', de: 'id', it: 'id' };

const RATIO_LABELS: Record<Lang, Record<RatioClass, string>> = {
  en: { ptFaster: 'PT faster or equal', upTo1_5: 'PT up to 1.5x car', upTo2: 'PT 1.5-2x car', over2: 'PT over 2x car', noPt: 'No PT' },
  fr: { ptFaster: 'TP plus rapide ou egal', upTo1_5: 'TP jusqu a 1,5x voiture', upTo2: 'TP 1,5 a 2x voiture', over2: 'TP plus de 2x voiture', noPt: 'Pas de TP' },
  de: { ptFaster: 'OeV schneller oder gleich', upTo1_5: 'OeV bis 1,5x Auto', upTo2: 'OeV 1,5 bis 2x Auto', over2: 'OeV ueber 2x Auto', noPt: 'Kein OeV' },
  it: { ptFaster: 'TP piu veloce o uguale', upTo1_5: 'TP fino a 1,5x auto', upTo2: 'TP da 1,5 a 2x auto', over2: 'TP oltre 2x auto', noPt: 'Nessun TP' },
};

const BOM = '﻿';

export function resultsToCsv(
  rows: ResultRow[],
  opts: { delimiter?: ',' | ';'; attributeColumns?: string[]; lang?: Lang } = {},
): string {
  const delimiter = opts.delimiter ?? ',';
  const lang = opts.lang ?? 'en';

  let attrCols = opts.attributeColumns;
  if (!attrCols) {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.attrs)) seen.add(k);
    attrCols = [...seen];
  }

  const quote = (s: string): string =>
    s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const text = (v: string | null | undefined): string => {
    if (v === null || v === undefined) return '';
    return quote(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  };
  const num = (v: number | null): string => (v === null || !Number.isFinite(v) ? '' : String(v));

  const lines: string[] = [];
  lines.push([ID_HEADER[lang], ...attrCols, ...HEADERS[lang]].map(quote).join(delimiter));
  for (const r of rows) {
    lines.push(
      [
        text(r.extId),
        ...attrCols.map((c) => text(r.attrs[c])),
        num(r.lat),
        num(r.lon),
        num(r.ptMin),
        num(r.ptChanges),
        num(r.ptDepartures),
        num(r.ptCost),
        text(r.ptProduct),
        text(r.boardStop),
        num(r.carMin),
        num(r.carKm),
        num(r.carCost),
        num(r.bikeMin),
        num(r.ebikeMin),
        num(r.walkMin),
        num(r.co2Pt),
        num(r.co2Car),
        quote(RATIO_LABELS[lang][r.ratioClass]),
        text(r.error),
      ].join(delimiter),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
