/**
 * Runs `task` at the visitor's first tap, click, key or turn of the wheel,
 * and returns a function that cancels it.
 *
 * For what should not appear before then. Chrome goes on choosing the page's
 * largest contentful paint until the visitor first does something, so a
 * block of text that appears later, but before that, can be counted as the
 * paint the whole page waited for. After it, nothing that appears is.
 */
const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export function afterFirstInteraction(task: () => void): () => void {
  const stop = () => {
    for (const type of EVENTS) window.removeEventListener(type, run, true);
  };
  function run() {
    stop();
    task();
  }
  for (const type of EVENTS) {
    window.addEventListener(type, run, { capture: true, passive: true });
  }
  return stop;
}
