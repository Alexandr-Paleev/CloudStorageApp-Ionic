import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { configured, allowCollectors, refuseCollectors, waiting } = vi.hoisted(() => ({
  configured: { current: true },
  allowCollectors: vi.fn(),
  refuseCollectors: vi.fn(),
  waiting: [] as (() => void)[],
}));

vi.mock('../analytics/consent', async (importActual) => ({
  ...(await importActual<typeof import('../analytics/consent')>()),
  collectorsConfigured: () => configured.current,
}));
vi.mock('../analytics/collectors', () => ({ allowCollectors, refuseCollectors }));
vi.mock('../utils/when-loaded', () => ({
  whenLoadedAndIdle: (task: () => void) => waiting.push(task),
}));

import { ConsentBanner } from './ConsentBanner';
import { askAgain, forgetConsent, writeConsent } from '../analytics/consent';
import { LEGAL_URL } from '../utils/legal.utils';

const TITLE = 'Analytics cookies';

/** The page has loaded and the browser is idle. */
function load() {
  act(() => {
    while (waiting.length > 0) waiting.shift()!();
  });
}

/** The visitor does something for the first time. */
function touch() {
  act(() => {
    window.dispatchEvent(new Event('pointerdown'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetConsent();
  configured.current = true;
  waiting.length = 0;
});

describe('ConsentBanner', () => {
  it('is not there while the page loads', () => {
    render(<ConsentBanner />);
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  /* Chrome goes on choosing the largest paint until the visitor does
     something. Text that arrived on its own before that could be chosen. */
  it('waits for the visitor to do something, once the page has loaded', () => {
    render(<ConsentBanner />);
    load();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();

    touch();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it('offers a no exactly as it offers a yes', () => {
    render(<ConsentBanner />);
    load();
    touch();

    const no = screen.getByText('Decline') as HTMLElement & { fill?: string };
    const yes = screen.getByText('Accept') as HTMLElement & { fill?: string };
    expect(no.fill).toBe('outline');
    expect(yes.fill).toBe(no.fill);
    expect(no.className).toBe(yes.className);
  });

  it('starts the collectors at a yes', () => {
    render(<ConsentBanner />);
    load();
    touch();

    fireEvent.click(screen.getByText('Accept'));

    expect(allowCollectors).toHaveBeenCalledTimes(1);
    expect(refuseCollectors).not.toHaveBeenCalled();
  });

  it('refuses them at a no', () => {
    render(<ConsentBanner />);
    load();
    touch();

    fireEvent.click(screen.getByText('Decline'));

    expect(refuseCollectors).toHaveBeenCalledTimes(1);
    expect(allowCollectors).not.toHaveBeenCalled();
  });

  it('goes once there is an answer, and comes back when it is asked for', () => {
    render(<ConsentBanner />);
    load();
    touch();

    act(() => writeConsent('denied'));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();

    act(() => askAgain());
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  /* "Cookie settings" is a request. It is not kept waiting for a page that
     has not been idle yet, and it puts the visitor where the question is. */
  it('comes at once when it is asked for, and takes the focus', () => {
    writeConsent('denied');
    render(<ConsentBanner />);

    act(() => askAgain());

    expect(screen.getByRole('complementary', { name: TITLE })).toHaveFocus();
  });

  it('gives the focus back once it is answered', () => {
    writeConsent('denied');
    const settings = document.createElement('button');
    document.body.append(settings);
    settings.focus();
    render(<ConsentBanner />);

    act(() => askAgain());
    act(() => writeConsent('granted'));

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(settings).toHaveFocus();
    settings.remove();
  });

  it('takes nothing when it comes on its own', () => {
    render(<ConsentBanner />);
    load();
    touch();

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not ask a visitor who has answered', () => {
    writeConsent('granted');
    render(<ConsentBanner />);
    load();
    touch();

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('asks nothing where nothing would run', () => {
    configured.current = false;
    render(<ConsentBanner />);
    load();
    touch();

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('says where the rest is written down', () => {
    render(<ConsentBanner />);
    load();
    touch();

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      LEGAL_URL.privacy
    );
  });
});
