import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/* Testing Library unmounts automatically only when Vitest runs with globals
   enabled. This project keeps them off — every test imports what it uses — so
   the teardown has to be registered by hand, or one test's DOM leaks into the
   next. */
afterEach(() => {
  cleanup();
});

/* jsdom implements none of these three, and Ionic's components reach for them
   on mount. Stubs are enough: nothing under test depends on their behaviour,
   only on their existence. */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

/* Ionic ships Stencil custom elements. Once jsdom upgrades one, Stencil's slot
   polyfill relocates its light-DOM children on a later frame, so the text in
   `<IonLabel>Auto</IonLabel>` is present at assertion time in some runs and
   gone in others — the same spec passing alone and failing next to another
   file. Nothing here is testing Ionic's own rendering: what these tests assert
   is which elements this app produces, with which attributes and handlers, and
   React sets both on the host element whether or not it ever upgrades. So the
   definitions are dropped on the floor and the markup stays as authored.

   The cost: an Ionic control never enforces its own `disabled` here, so a test
   asserting that a disabled control ignores a click would pass without proving
   anything. Assert on the handler's own guard instead — as
   ProviderSelector.test.tsx does. */
customElements.define = () => {};

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

vi.stubGlobal('ResizeObserver', globalThis.ResizeObserver ?? ObserverStub);
vi.stubGlobal('IntersectionObserver', globalThis.IntersectionObserver ?? ObserverStub);
