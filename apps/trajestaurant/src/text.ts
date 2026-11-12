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
