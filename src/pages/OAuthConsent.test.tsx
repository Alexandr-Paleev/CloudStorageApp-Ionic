import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import OAuthConsent from './OAuthConsent';
import { renderWithProviders } from '../test/utils';
import { leavePendingConsent, pendingConsent } from '../utils/pending-consent';

const { auth, pending, answer, leaveFor, logout } = vi.hoisted(() => ({
  auth: {
    current: { user: { id: 'user-1', email: 'alex@example.com' } as unknown, loading: false },
  },
  pending: vi.fn(),
  answer: vi.fn(),
  leaveFor: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth.current, logout }),
}));

vi.mock('../services/assistants.service', async (importActual) => ({
  ...(await importActual<typeof import('../services/assistants.service')>()),
  default: {
    pending: (...args: unknown[]) => pending(...args),
    answer: (...args: unknown[]) => answer(...args),
  },
  leaveFor: (url: string) => leaveFor(url),
}));

vi.mock('../supabase/supabase.config', () => ({ supabase: {} }));

const REQUEST = {
  kind: 'ask',
  request: {
    id: 'auth-1',
    client: { id: 'c-1', name: 'Claude', uri: 'https://claude.ai', logoUri: '' },
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    email: 'alex@example.com',
  },
};

/** Where the page has put itself. */
function Address() {
  const { pathname, search } = useLocation();
  return <output>{pathname + search}</output>;
}

function show(route = '/oauth/consent?authorization_id=auth-1') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/oauth/consent"
        element={
          <>
            <OAuthConsent />
            <Address />
          </>
        }
      />
      <Route path="/login" element={<p>Sign in</p>} />
      <Route path="/dashboard" element={<p>Your files</p>} />
    </Routes>,
    { route }
  );
}

/** Ionic buttons render as custom elements with no implicit role. */
function button(label: string): HTMLElement {
  const found = [...document.querySelectorAll('ion-button')].find((el) => el.textContent === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.current = { user: { id: 'user-1', email: 'alex@example.com' }, loading: false };
  pending.mockResolvedValue(REQUEST);
  answer.mockResolvedValue('https://claude.ai/api/mcp/auth_callback?code=x');
  logout.mockResolvedValue(undefined);
});

describe('OAuthConsent (ADR 0020)', () => {
  it('shows who asks, where the answer leads, and what it lets in and keeps out', async () => {
    show();

    expect(await screen.findByText('Claude')).toBeTruthy();
    expect(screen.getByText('claude.ai')).toBeTruthy();
    expect(screen.getByText(/A link someone sent you can ask for your files/)).toBeTruthy();
    expect(screen.getByText(/search them by meaning/)).toBeTruthy();
    expect(screen.getByText(/upload, rename, move, delete or share a file/)).toBeTruthy();
    expect(pending).toHaveBeenCalledWith('auth-1');
  });

  it('allows, and goes back to the assistant with what Supabase says', async () => {
    leavePendingConsent('auth-1');
    show();
    fireEvent.click(await waitFor(() => button('Allow')));

    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=x')
    );
    expect(answer).toHaveBeenCalledWith('auth-1', true);
    expect(pendingConsent()).toBeNull();
  });

  it('denies', async () => {
    show();
    fireEvent.click(await waitFor(() => button('Deny')));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('auth-1', false));
    expect(leaveFor).toHaveBeenCalled();
  });

  it('lets a demo account only refuse, and says why', async () => {
    auth.current = {
      user: { id: 'user-1', email: 'demo-1700000000-ab12@example.com' },
      loading: false,
    };
    show();

    expect(await screen.findByText(/A demo account cannot connect an assistant/)).toBeTruthy();
    expect(() => button('Allow')).toThrow();
    fireEvent.click(button('Deny'));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('auth-1', false));
  });

  it('sends a signed-out person to sign in, and keeps the request for after', async () => {
    auth.current = { user: null, loading: false };
    show();

    expect(await screen.findByText('Sign in')).toBeTruthy();
    expect(pendingConsent()).toBe('auth-1');
    expect(pending).not.toHaveBeenCalled();
  });

  it('picks the request up again after signing in, and moves it to the address', async () => {
    // Google comes back to /oauth/consent with no id in the address.
    leavePendingConsent('auth-1');
    show('/oauth/consent');
    expect(await screen.findByText('Claude')).toBeTruthy();
    expect(pending).toHaveBeenCalledWith('auth-1');
    expect(await screen.findByText('/oauth/consent?authorization_id=auth-1')).toBeTruthy();
    // Out of sessionStorage: walked away from, it must not lead the next sign-in here.
    expect(pendingConsent()).toBeNull();
  });

  it('goes straight back when the request was answered before', async () => {
    pending.mockResolvedValue({ kind: 'answered', goTo: 'https://claude.ai/cb?code=y' });
    show();
    await waitFor(() => expect(leaveFor).toHaveBeenCalledWith('https://claude.ai/cb?code=y'));
  });

  it('says a link with no request, or a malformed one, is not complete', async () => {
    show('/oauth/consent');
    expect(await screen.findByText(/this link is not complete/)).toBeTruthy();

    leavePendingConsent('auth-1');
    show('/oauth/consent?authorization_id=../user');
    expect((await screen.findAllByText(/this link is not complete/)).length).toBe(2);
    expect(pending).not.toHaveBeenCalled();
  });

  it('says what went wrong when the request cannot be read, and offers a way on', async () => {
    leavePendingConsent('auth-1');
    pending.mockRejectedValue(new Error('authorization request expired'));
    show();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'authorization request expired'
    );
    expect(pendingConsent()).toBeNull();
    fireEvent.click(button('Go to your files'));
    expect(await screen.findByText('Your files')).toBeTruthy();
  });

  it('signs out to answer as another account, and keeps the request', async () => {
    show();
    fireEvent.click(await screen.findByText('Use another account'));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(pendingConsent()).toBe('auth-1');
  });
});
