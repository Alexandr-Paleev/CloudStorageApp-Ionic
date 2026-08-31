/**
 * Keeps `body.dark` in step with the operating system.
 *
 * The stylesheets were written for it — nineteen rules across variables.css,
 * global.css, Dashboard.css and FileView.css — and nothing ever added the
 * class, so every one of them was dead.
 *
 * That left the dark theme wired up on one side only. A `prefers-color-scheme`
 * block in variables.css set `--ion-text-color` to near-white, and that half
 * did apply, while the surfaces meant to darken alongside it stayed light. On
 * the login page the result measured 1.05:1 between the text in the form and
 * the card behind it: what a visitor typed was invisible unless they selected
 * it. That block is gone; this is what replaces it.
 *
 * The trade-off it leaves: a dark-mode visitor sees the light theme until this
 * runs. Painting the background dark from CSS first would only swap a white
 * flash for an unreadable one — dark text on a dark ground — and removing the
 * flash properly needs an inline script in <head>, which is a bigger change
 * than it looks in a bundle with a strict Content-Security-Policy.
 *
 * Toggling the class is the smaller half of the fix and the one that makes the
 * CSS already in the repository do what it says.
 */

const DARK = '(prefers-color-scheme: dark)';

export function initDarkMode(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;

  const query = window.matchMedia(DARK);
  const apply = (matches: boolean) => document.body.classList.toggle('dark', matches);

  apply(query.matches);

  // addEventListener rather than the deprecated addListener, with no removal:
  // this lives for the lifetime of the document by design.
  query.addEventListener('change', (event) => apply(event.matches));
}
