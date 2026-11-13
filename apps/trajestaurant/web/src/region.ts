import { regionOf, type Region } from '../../src/regions';

/** The edition the page was served for (src/regions.ts): the server writes it into the page. */
function fromPage(): string | null {
  if (typeof document === 'undefined') return null;
  const id = document.querySelector('meta[name="region"]')?.getAttribute('content');
  return id && !id.startsWith('{{') ? id : null;
}

export const REGION: Region = regionOf(fromPage());
// The edition's colours (styles.css: :root[data-region=…]).
if (typeof document !== 'undefined') document.documentElement.dataset.region = REGION.id;
