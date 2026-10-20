/**
 * Writes into local storage as another tab of the app would, and returns once
 * this page has been told.
 *
 * A browser tells every other tab of the origin that local storage changed,
 * and never the tab that changed it: a `storage` event, after the write. jsdom
 * does the same between windows of one origin (its Storage-impl), so a frame
 * of the page's own origin stands in for the other tab. What this page hears
 * is then the event jsdom makes, with the key and the values it fills in.
 *
 * A test does not build one with `new StorageEvent(type, init)`: CodeQL takes
 * that for a call with too many arguments (js/superfluous-trailing-arguments),
 * since its model of the DOM (javascript/externs/web/webstorage.js in
 * github/codeql) declares the constructor with no parameters.
 */
export async function inAnotherTab(write: (storage: Storage) => void): Promise<void> {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  write(frame.contentWindow!.localStorage);
  /* jsdom tells the other windows on a timer it sets at the write, and a
     timer set after it runs after it. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  frame.remove();
}
