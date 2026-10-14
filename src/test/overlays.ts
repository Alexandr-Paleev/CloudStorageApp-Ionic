import { act, fireEvent } from '@testing-library/react';

/**
 * Ionic's overlays, as far as jsdom can see them.
 *
 * `setup.ts` keeps Ionic's custom elements from being defined, so an alert in
 * a test is an empty `<ion-alert>`: no shadow root, no button to click, no
 * field to type into. Everything the app handed it is there all the same.
 * React sets the header, the buttons and their handlers on the host element
 * as properties, whether or not the element is ever upgraded, and listens on
 * it for `didDismiss`.
 *
 * So a test presses a button by calling the handler the app wrote for it, and
 * closes an overlay by sending the event Ionic would have sent. That is the
 * app's half of the contract and none of Ionic's. Whether a dialog shows,
 * takes typing and goes away is for a real browser to say, in e2e/.
 *
 * Before this, the one test that tried to press a button in an alert looked
 * for it in the DOM, found nothing, waited two seconds for a call that could
 * not come, and caught its own timeout. It had been green since it was
 * written.
 */

interface OverlayButton {
  text: string;
  role?: string;
  handler?: (data?: unknown) => boolean | void;
}

export type Overlay = HTMLElement & {
  isOpen?: boolean;
  header?: string;
  message?: string;
  buttons?: OverlayButton[];
  inputs?: { name?: string; value?: string; placeholder?: string }[];
};

type OverlayTag = 'ion-alert' | 'ion-action-sheet' | 'ion-toast';

/** Every overlay of one kind on the page, shown or not. They are all in the DOM at once. */
export function overlays(tag: OverlayTag): Overlay[] {
  return [...document.querySelectorAll<Overlay>(tag)];
}

/** The overlay under this header. */
export function overlay(tag: OverlayTag, header: string): Overlay {
  const found = overlays(tag).find((element) => element.header === header);
  if (!found) throw new Error(`No ${tag} with the header "${header}"`);
  return found;
}

/**
 * Runs the handler the app wrote for a button, and says whether the overlay
 * may close: a handler that returns false keeps it open.
 */
export function choose(element: Overlay, text: string, data?: unknown): boolean {
  const button = element.buttons?.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`No "${text}" button on that ${element.tagName.toLowerCase()}`);

  let closes = true;
  act(() => {
    closes = button.handler?.(data) !== false;
  });
  return closes;
}

/** What Ionic sends once an overlay has gone. */
export function dismiss(element: Overlay): void {
  fireEvent(element, new CustomEvent('didDismiss'));
}

/** A press as Ionic carries it out: the handler, and then the overlay goes unless the handler said no. */
export function press(element: Overlay, text: string, data?: unknown): void {
  if (choose(element, text, data)) dismiss(element);
}
