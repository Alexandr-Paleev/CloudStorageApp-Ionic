import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNativePlatform, statusBar, keyboard, share, haptics } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  statusBar: { setOverlaysWebView: vi.fn(), setStyle: vi.fn() },
  keyboard: { setResizeMode: vi.fn(), setAccessoryBarVisible: vi.fn() },
  share: { canShare: vi.fn(), share: vi.fn() },
  haptics: { impact: vi.fn(), notification: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: statusBar,
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: keyboard,
  KeyboardResize: { Body: 'body', Native: 'native' },
}));
vi.mock('@capacitor/share', () => ({ Share: share }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: haptics,
  ImpactStyle: { Light: 'LIGHT', Heavy: 'HEAVY' },
  NotificationType: { Warning: 'WARNING' },
}));

import {
  initNativeShell,
  syncStatusBarStyle,
  setStatusBarForDarkBackground,
  offerSystemShare,
  tapFeedback,
} from './shell';

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(false);
  document.body.classList.remove('dark');
  statusBar.setOverlaysWebView.mockResolvedValue(undefined);
  statusBar.setStyle.mockResolvedValue(undefined);
  keyboard.setResizeMode.mockResolvedValue(undefined);
  keyboard.setAccessoryBarVisible.mockResolvedValue(undefined);
  share.canShare.mockResolvedValue({ value: true });
  share.share.mockResolvedValue(undefined);
  haptics.impact.mockResolvedValue(undefined);
});

describe('the native shell', () => {
  /* Every one of these plugins throws in a browser. Guarded by the platform
     check rather than by catching, because a caught error looks the same as a
     plugin that is genuinely broken. */
  it('touches nothing at all on the web', async () => {
    await initNativeShell();
    tapFeedback();

    expect(statusBar.setOverlaysWebView).not.toHaveBeenCalled();
    expect(keyboard.setResizeMode).not.toHaveBeenCalled();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(await offerSystemShare('https://example.com', 'a file')).toBe(false);
  });

  /* Insetting the WebView is the Android reflex, and on iOS it fills the gap
     with the window background: a solid black band with no clock in it, seen on
     the simulator before this test existed. Ionic's safe-area padding already
     keeps every header clear, and the login gradient wants the top edge. */
  it('leaves the status bar overlaying, and sizes the keyboard to the body', async () => {
    isNativePlatform.mockReturnValue(true);
    await initNativeShell();

    expect(statusBar.setOverlaysWebView).not.toHaveBeenCalled();
    expect(keyboard.setResizeMode).toHaveBeenCalledWith({ mode: 'body' });
    expect(keyboard.setAccessoryBarVisible).toHaveBeenCalledWith({ isVisible: true });
  });

  /* Style.Dark is light glyphs on a dark bar — named for the theme, not the
     colour, which is the reading that costs people an afternoon. */
  it('follows the theme the page is in', async () => {
    isNativePlatform.mockReturnValue(true);

    await syncStatusBarStyle();
    expect(statusBar.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });

    document.body.classList.add('dark');
    await syncStatusBarStyle();
    expect(statusBar.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
  });

  /* A plugin that will not start must not take the startup down with it. */
  it('carries on when the status bar refuses', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    statusBar.setStyle.mockRejectedValue(new Error('no bridge'));

    await expect(initNativeShell()).resolves.toBeUndefined();
    expect(keyboard.setResizeMode).toHaveBeenCalled();
  });

  /* The login page is a dark gradient in both themes, so it asks for light
     glyphs directly rather than following body.dark — which would hide the
     clock on the one screen the app did not draw it on. */
  it('lets a screen override the style for its own background', async () => {
    isNativePlatform.mockReturnValue(true);

    await setStatusBarForDarkBackground(true);
    expect(statusBar.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });

    await setStatusBarForDarkBackground(false);
    expect(statusBar.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });

  it('offers the system sheet on a device', async () => {
    isNativePlatform.mockReturnValue(true);
    expect(await offerSystemShare('https://example.com/x', 'holiday.jpg')).toBe(true);
    expect(share.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/x', title: 'holiday.jpg' })
    );
  });

  /* Falls back to the clipboard rather than doing nothing quietly. */
  it('says no where the device reports no sheet', async () => {
    isNativePlatform.mockReturnValue(true);
    share.canShare.mockResolvedValue({ value: false });

    expect(await offerSystemShare('https://example.com/x', 'a file')).toBe(false);
    expect(share.share).not.toHaveBeenCalled();
  });

  /* The plugin rejects when the user dismisses the sheet. Reporting that as a
     failure would put "sharing failed" in front of someone who changed their
     mind — and would then copy to their clipboard behind their back. */
  it('treats a dismissed sheet as handled, not as an error', async () => {
    isNativePlatform.mockReturnValue(true);
    share.share.mockRejectedValue(new Error('cancelled'));

    expect(await offerSystemShare('https://example.com/x', 'a file')).toBe(true);
  });
});
