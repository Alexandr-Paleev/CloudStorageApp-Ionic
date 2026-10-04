import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import Account from './Account';
import { renderWithProviders } from '../test/utils';

const {
  deleteAccount,
  createPortalSession,
  getUserStorageSize,
  profileMock,
  envMock,
  isNativePlatform,
} = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  createPortalSession: vi.fn(),
  getUserStorageSize: vi.fn(),
  profileMock: {
    current: {
      tier: 'free',
      storage_limit: 500 * 1024 * 1024,
      created_at: '2026-01-10T00:00:00.000Z',
    } as Record<string, unknown> | null,
  },
  envMock: { VITE_BILLING_ENABLED: true },
  isNativePlatform: vi.fn(() => false),
}));

vi.mock('../services/account.service', () => ({
  default: { deleteAccount: (...args: unknown[]) => deleteAccount(...args) },
}));

vi.mock('../services/billing.service', () => ({
  default: { createPortalSession: () => createPortalSession() },
}));

vi.mock('../services/storage.service', () => ({
  default: { getUserStorageSize: (...args: unknown[]) => getUserStorageSize(...args) },
}));

vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({ profile: profileMock.current, isLoading: false, error: null }),
}));

vi.mock('../env', () => ({ env: envMock }));

/* The real billingIsOffered() runs on top of both of these — mocking the
   predicate itself would test the mock rather than the rule it encodes. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'someone@example.com' } }),
}));

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Account />} />
      <Route path="/login" element={<p>Sign in</p>} />
      <Route path="/pricing" element={<p>Pro plan</p>} />
    </Routes>
  );
}

/** Ionic controls report through their own events, not the DOM ones, and
 *  render as custom elements with no implicit ARIA role — so both the input
 *  and the button are reached as elements rather than by role. */
function confirm(word: string) {
  const input = document.querySelector('ion-input')!;
  fireEvent(input, new CustomEvent('ionInput', { detail: { value: word } }));
}

function deleteButton(): HTMLElement & { disabled?: boolean } {
  return document.querySelector('ion-button[color="danger"]')!;
}

/** The section is closed until someone asks for it. */
function openDangerZone() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAccount.mockResolvedValue({ failures: [] });
  getUserStorageSize.mockResolvedValue(125 * 1024 * 1024);
  createPortalSession.mockResolvedValue('https://billing.stripe.com/session');
  profileMock.current = {
    tier: 'free',
    storage_limit: 500 * 1024 * 1024,
    created_at: '2026-01-10T00:00:00.000Z',
  };
  envMock.VITE_BILLING_ENABLED = true;
  isNativePlatform.mockReturnValue(false);
});

describe('Account', () => {
  it('shows which account is signed in', () => {
    show();
    expect(screen.getByText('someone@example.com')).toBeInTheDocument();
  });

  it('says which plan the account is on', () => {
    show();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('shows what the account has stored against what it may store', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/125\.00 MB of 500\.00 MB/)).toBeInTheDocument());
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('says plainly when an account is over its limit', async () => {
    // A downgrade leaves an account above the new limit, and a bar pinned at
    // the end says nothing about by how much.
    getUserStorageSize.mockResolvedValue(600 * 1024 * 1024);
    show();

    await waitFor(() => expect(screen.getByText(/over the limit/)).toBeInTheDocument());
  });

  it('points a free account at the plan rather than at a checkout', () => {
    show();
    fireEvent.click(screen.getByText('See Pro'));
    expect(screen.getByText('Pro plan')).toBeInTheDocument();
  });

  it('sends a Pro account to the portal it pays through', async () => {
    profileMock.current = { tier: 'pro', storage_limit: 5 * 1024 * 1024 * 1024 };
    show();

    fireEvent.click(screen.getByText('Manage billing'));
    await waitFor(() => expect(createPortalSession).toHaveBeenCalledTimes(1));
  });

  it('offers nothing to manage where billing is switched off', () => {
    envMock.VITE_BILLING_ENABLED = false;
    show();

    expect(screen.queryByText('See Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage billing')).not.toBeInTheDocument();
  });

  it('offers nothing to buy inside the native shell', async () => {
    /* App Store 3.1.1 forbids a button that steers towards a purchase made
       anywhere but In-App Purchase, and /pricing bounces back to the dashboard
       there — so a visible "See Pro" was both a rejection risk and a button
       that did nothing. See ADR 0012. */
    isNativePlatform.mockReturnValue(true);
    show();

    expect(screen.queryByText('See Pro')).not.toBeInTheDocument();

    profileMock.current = { tier: 'pro', storage_limit: 5 * 1024 * 1024 * 1024 };
    show();
    expect(screen.queryByText('Manage billing')).not.toBeInTheDocument();
  });

  it('says so beside the button when the portal will not open', async () => {
    profileMock.current = { tier: 'pro', storage_limit: 5 * 1024 * 1024 * 1024 };
    createPortalSession.mockRejectedValue(new Error('Stripe is not configured'));
    show();

    fireEvent.click(screen.getByText('Manage billing'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Stripe is not configured')
    );
  });

  it('explains a full bar even when nothing is over the limit', async () => {
    getUserStorageSize.mockResolvedValue(500 * 1024 * 1024);
    show();

    await waitFor(() => expect(screen.getByText(/Storage is full/)).toBeInTheDocument());
  });

  /* The page used to open on a red box with a red button in it — the first
     thing an account's own settings said to its owner was "you can destroy
     this". */
  it('keeps the destructive part closed until it is asked for', () => {
    show();
    expect(document.querySelector('ion-input')).toBeNull();
    expect(deleteButton()).toBeNull();

    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    openDangerZone();
    expect(document.querySelector('ion-input')).not.toBeNull();
  });

  it('can be backed out of without deleting anything', () => {
    show();
    openDangerZone();
    confirm('DELETE');

    fireEvent.click(screen.getByText('Cancel'));

    expect(document.querySelector('ion-input')).toBeNull();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  /* A destructive action reachable by one tap is one a person can take without
     having decided to. */
  it('keeps the delete button disabled until the word is typed exactly', () => {
    show();
    openDangerZone();
    expect(deleteButton().disabled).toBe(true);

    confirm('delete');
    expect(deleteButton().disabled).toBe(true);

    confirm('DELETE');
    expect(deleteButton().disabled).toBe(false);
  });

  it('deletes the account and leaves for the login page', async () => {
    show();
    openDangerZone();
    confirm('DELETE');
    fireEvent.click(deleteButton());

    await waitFor(() => expect(screen.getByText('Sign in')).toBeInTheDocument());
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('stays put and says what went wrong when the request fails', async () => {
    deleteAccount.mockRejectedValue(new Error('Failed to delete the account'));
    show();
    openDangerZone();
    confirm('DELETE');
    fireEvent.click(deleteButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to delete the account')
    );
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });
});
