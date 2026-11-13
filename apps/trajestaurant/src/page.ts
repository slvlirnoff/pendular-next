import { regionName, type Region } from './regions.js';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The site's page for a region: web/index.html holds {{REGION}}, {{LANG}}, {{TITLE}},
 * {{DESCRIPTION}} and {{THEME}}, filled by the server (production) and by vite (development),
 * so that one build serves every region. The page is in the region's first language; the site
 * then names itself in the language chosen.
 */
export function renderPage(html: string, r: Region): string {
  const lang = r.langs[0]!;
  return html
    .replaceAll('{{REGION}}', r.id)
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{TITLE}}', attr(regionName(r, lang)))
    .replaceAll('{{DESCRIPTION}}', attr(r.description[lang] ?? ''))
    .replaceAll('{{THEME}}', r.themeColor);
}
