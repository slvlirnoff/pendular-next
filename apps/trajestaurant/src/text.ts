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
