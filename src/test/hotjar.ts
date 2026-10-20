/**
 * Where Hotjar would read a piece of text, if it recorded this page.
 *
 * Its rule, as its own code has it (`hj.privacy` in
 * script.hotjar.com/modules.cbb571aa58c48ef8fa6e.js, read on 2026-10-18):
 *
 * - Text is left out when the element holding it, or any element above it,
 *   carries `data-hj-suppress` (or `data-hj-masked`).
 * - An attribute is left out only when it is one of the few below and its
 *   element is left out in that way. Any other attribute is recorded as it
 *   is, inside a hidden element or not: `aria-label`, and an iframe's `title`
 *   and `src`, among them.
 * - An image, a video or a source under such an element is replaced whole,
 *   its address included.
 *
 * Ionic's dialogs are seen here as the app hands them over. jsdom never draws
 * them (src/test/setup.ts), so what they would show is the element's
 * properties. Ionic draws an alert and an action sheet in the page's own DOM,
 * under their element, so they are left out when `htmlAttributes` puts the
 * attribute on it. A string prop is another matter: @ionic/react writes it
 * onto the element as an attribute as well, and the walk below finds it there.
 */
const HIDDEN_WHEN_SUPPRESSED: Record<string, readonly string[]> = {
  INPUT: ['value', 'placeholder'],
  TEXTAREA: ['value', 'placeholder'],
  A: ['href'],
  OPTION: ['label', 'value'],
  PROGRESS: ['value'],
  OPTGROUP: ['label'],
  IMG: ['alt', 'src', 'srcset', 'style'],
  VIDEO: ['alt', 'src', 'srcset', 'style'],
  SOURCE: ['alt', 'src', 'srcset', 'style'],
  DIV: ['title'],
  SPAN: ['title'],
  P: ['title'],
};

const suppressed = (element: Element | null): boolean =>
  element?.closest('[data-hj-suppress], [data-hj-masked]') != null;

type IonicDialog = Element & {
  header?: unknown;
  subHeader?: unknown;
  message?: unknown;
  inputs?: { value?: unknown; placeholder?: unknown }[];
  htmlAttributes?: Record<string, unknown>;
};

const DIALOGS = new Set(['ion-alert', 'ion-action-sheet']);

/** Every place under `root` where Hotjar would record `text` as it is. */
export function whereHotjarWouldRead(text: string, root: Node = document.body): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.includes(text) && !suppressed(node.parentElement)) {
        found.push(`text in <${node.parentElement?.localName}>`);
      }
      continue;
    }

    const element = node as Element;
    for (const { name, value } of Array.from(element.attributes)) {
      if (!value.includes(text)) continue;
      const hides = HIDDEN_WHEN_SUPPRESSED[element.tagName]?.includes(name) ?? false;
      if (!hides || !suppressed(element)) found.push(`${name} of <${element.localName}>`);
    }

    if (DIALOGS.has(element.localName)) {
      const dialog = element as IonicDialog;
      const shows = [
        dialog.header,
        dialog.subHeader,
        dialog.message,
        ...(dialog.inputs ?? []).flatMap((input) => [input.value, input.placeholder]),
      ];
      const hidden =
        suppressed(element) || dialog.htmlAttributes?.['data-hj-suppress'] !== undefined;
      if (!hidden && shows.some((shown) => typeof shown === 'string' && shown.includes(text))) {
        found.push(`what <${element.localName}> draws`);
      }
    }
  }

  return found;
}
