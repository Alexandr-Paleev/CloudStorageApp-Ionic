import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * The parts of the app that only exist on a device.
 *
 * Everything here is a no-op in a browser, checked once through
 * `Capacitor.isNativePlatform()` rather than by catching the errors the plugins
 * throw on the web — a caught error is indistinguishable from a plugin that is
 * genuinely broken.
 *
 * These four plugins had been in `package.json` since v1 and imported nowhere,
 * which is worse than not having them: it reads as native support that does not
 * exist. It also left the shell indistinguishable from the website it wraps,
 * and App Store guideline 4.2 turns that down.
 */

export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Status bar and keyboard, set once at startup.
 *
 * The status bar is left **overlaying** the WebView, which is the iOS default
 * and was worth trying to change exactly once. `setOverlaysWebView(false)` is
 * the reflex carried over from Android, and on a simulator it produces a solid
 * black band across the top of every screen: the call insets the WebView, and
 * what fills the gap is the window background, not the page. The login gradient
 * ran out under a black stripe with no clock in it.
 *
 * Overlaying is also what the design already assumes. Ionic derives
 * `--ion-safe-area-top` from `env(safe-area-inset-top)` and every `ion-header`
 * in this app pads itself by it, so the toolbar already sits below the clock
 * without being told; the login page has no header and *wants* its gradient to
 * run to the top edge.
 *
 * The keyboard resizes the body rather than the whole native view. `Native`
 * would push the entire WebView up, taking the header off the top of the
 * screen; `Body` shrinks the scrolling area and leaves the chrome where it is,
 * which is what a form on a phone should do.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;

  try {
    await syncStatusBarStyle();
  } catch (error) {
    console.warn('Status bar setup failed:', error);
  }

  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    /* The row above the keyboard carrying Done and the arrows. Without it a
       long form on iOS can only be left by tapping outside the field. */
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch (error) {
    console.warn('Keyboard setup failed:', error);
  }
}

/**
 * Matches the status bar to the theme.
 *
 * `Style.Dark` means *light content on a dark bar*, which is the reading that
 * costs people an afternoon — it is named for the theme it belongs to, not for
 * the colour of the glyphs.
 *
 * Called again from the dark-mode listener, because the OS can change this
 * while the app is open and a status bar that stays light on a dark page is
 * the most visible way to look unfinished.
 */
export async function syncStatusBarStyle(): Promise<void> {
  if (!isNative()) return;

  const dark = document.body.classList.contains('dark');
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch (error) {
    console.warn('Status bar style failed:', error);
  }
}

/**
 * Overrides the style for a screen whose own colours disagree with the theme.
 *
 * The login page is a deep indigo gradient in both themes, and the status bar
 * sits on top of it. Following `body.dark` there would put dark glyphs on a
 * dark ground in the light theme — the clock disappears, which is the one thing
 * on that screen the app did not draw and cannot be blamed for losing.
 *
 * Callers pass `true` for a dark ground. Restoring is the caller's job on the
 * way out, through `syncStatusBarStyle()`.
 */
export async function setStatusBarForDarkBackground(dark: boolean): Promise<void> {
  if (!isNative()) return;

  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch (error) {
    console.warn('Status bar style failed:', error);
  }
}

/**
 * Offers a link through the operating system's own share sheet.
 *
 * Returns false where there is no sheet to offer — in a browser, and on a
 * device that reports sharing as unavailable — so the caller can fall back to
 * the clipboard rather than silently doing nothing. `Share.canShare()` is
 * asked rather than assumed: it is the plugin's own answer, and it is what
 * distinguishes "no sheet here" from "the sheet failed".
 *
 * A dismissed sheet is success, not failure. The plugin rejects when the user
 * cancels, and reporting that as an error would put "sharing failed" in front
 * of someone who simply changed their mind.
 */
export async function offerSystemShare(url: string, title: string): Promise<boolean> {
  if (!isNative()) return false;

  try {
    const { value } = await Share.canShare();
    if (!value) return false;

    await Share.share({ title, text: title, url, dialogTitle: 'Share this file' });
    return true;
  } catch {
    /* Cancelled, or the sheet would not open. Either way the link is not lost:
       the caller has it and the clipboard path still works. */
    return true;
  }
}

/** A tap that changed something. Silent on the web, and never awaited by a
 *  caller that has real work to do — feedback must not delay the action. */
export function tapFeedback(style: ImpactStyle = ImpactStyle.Light): void {
  if (!isNative()) return;
  Haptics.impact({ style }).catch(() => undefined);
}

/** The heavier one, for a destructive action being confirmed. */
export function warnFeedback(): void {
  if (!isNative()) return;
  Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
}
