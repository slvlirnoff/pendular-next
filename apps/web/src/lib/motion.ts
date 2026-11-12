import { flushSync } from 'react-dom';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Brings an element into view when it is not: its top goes near the top of the window. An
 * element already on screen is left where it is, so that a click never moves what was clicked.
 */
export function reveal(el: Element | null | undefined, margin = 16): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  // On screen: the top is visible and at least the head of the element fits below it.
  if (r.top >= 0 && r.top <= innerHeight - Math.min(r.height, 160)) return;
  scrollTo({ top: scrollY + r.top - margin, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** After the next paint: when the page has taken its new layout. */
export const afterPaint = (f: () => void) => requestAnimationFrame(() => requestAnimationFrame(f));

type WithTransitions = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * A change of view (the comparison, the timetable of a ticket): the two cross-fade where the
 * browser can do it, and the change is immediate elsewhere or when motion is not wanted.
 */
export function changeView(update: () => void, after?: () => void): void {
  const doc = document as WithTransitions;
  const run = () => {
    // The new view is on the page before `after` runs (a scroll position, for instance).
    flushSync(update);
    after?.();
  };
  if (!doc.startViewTransition || reducedMotion()) run();
  else doc.startViewTransition(run);
}
