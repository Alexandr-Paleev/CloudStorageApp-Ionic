import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useNavigate } from 'react-router';
import { PageViewTracker } from './PageViewTracker';
import { renderWithProviders } from '../test/utils';

const { trackPageView, startCollectorsOnABareAddress } = vi.hoisted(() => ({
  trackPageView: vi.fn(),
  startCollectorsOnABareAddress: vi.fn(),
}));

vi.mock('../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackPageView }) }));
vi.mock('../analytics/collectors', () => ({ startCollectorsOnABareAddress }));

/** Lets a test move the router, as a page of the app would. */
let go: (to: string) => void = () => undefined;
const Mover: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    go = (to) => void navigate(to);
  }, [navigate]);
  return null;
};

function showAt(route: string) {
  return renderWithProviders(
    <>
      <PageViewTracker />
      <Mover />
    </>,
    { route }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* The page used to be reported with its query string. An OAuth callback's
   code reached Google Analytics that way, as the path of a page view. */
describe('PageViewTracker', () => {
  it('reports a page by its path', () => {
    showAt('/dashboard');

    expect(trackPageView).toHaveBeenCalledWith('/dashboard');
  });

  it.each([
    ['a code after the ?', '/auth/dropbox/callback?code=abc&state=x', '/auth/dropbox/callback'],
    ['tokens after the #', '/dashboard#access_token=aaa&refresh_token=rrr', '/dashboard'],
  ])('never reports what an address carries besides: %s', (_what, route, path) => {
    showAt(route);

    expect(trackPageView.mock.calls).toEqual([[path]]);
  });

  it('reports each page once, and not again when only the query string changes', () => {
    showAt('/dashboard');
    act(() => go('/dashboard?sort=name'));
    act(() => go('/file/1'));

    expect(trackPageView.mock.calls).toEqual([['/dashboard'], ['/file/1']]);
  });

  /* The collectors are held back on an address that carries something, and
     a change of route is one of the moments it stops carrying it. */
  it('asks for the collectors to be started whenever the address changes, with the address', () => {
    showAt('/auth/dropbox/callback?code=abc');
    expect(startCollectorsOnABareAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: '?code=abc', hash: '' })
    );

    act(() => go('/account'));
    expect(startCollectorsOnABareAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/account', search: '', hash: '' })
    );
  });

  it('asks before it reports, so that the first page on a bare address is counted', () => {
    showAt('/dashboard');

    expect(startCollectorsOnABareAddress.mock.invocationCallOrder[0]).toBeLessThan(
      trackPageView.mock.invocationCallOrder[0] ?? 0
    );
  });
});
