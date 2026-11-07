import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveDeletionNotice, takeDeletionNotice } from './deletion-notice';

/* Who is signed in, as PrivateRoute asks it. Signing out tells it at once,
   as the auth context's listener does when Supabase says SIGNED_OUT. */
const auth = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  listeners: new Set<() => void>(),
}));

vi.mock('../contexts/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAuth: () => ({
      user: useSyncExternalStore(
        (listener) => {
          auth.listeners.add(listener);
          return () => auth.listeners.delete(listener);
        },
        () => auth.user
      ),
      loading: false,
    }),
  };
});

import PrivateRoute from '../components/PrivateRoute';

function signOut() {
  auth.user = null;
  auth.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  sessionStorage.clear();
  auth.user = { id: 'user-1' };
});
afterEach(() => vi.restoreAllMocks());

describe('the notice a deletion leaves for the login page', () => {
  it('is taken as it was left, and only once', () => {
    leaveDeletionNotice({ failures: ['cloudinary', 'r2'] });

    expect(takeDeletionNotice()).toEqual({ failures: ['cloudinary', 'r2'] });
    expect(takeDeletionNotice()).toBeNull();
  });

  it('is nothing when none was left', () => {
    expect(takeDeletionNotice()).toBeNull();
  });

  it('keeps only the names it can say, from whatever storage holds', () => {
    sessionStorage.setItem('account-deleted', JSON.stringify({ failures: ['r2', 7, null] }));

    expect(takeDeletionNotice()).toEqual({ failures: ['r2'] });
  });

  it('is dropped, and nothing said, when what is stored is not JSON', () => {
    sessionStorage.setItem('account-deleted', '{not json');

    expect(takeDeletionNotice()).toBeNull();
    expect(sessionStorage.getItem('account-deleted')).toBeNull();
  });

  it('is not left where storage refuses it, and the deletion is not failed for that', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => leaveDeletionNotice({ failures: [] })).not.toThrow();
  });

  it('is nothing where storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled.', 'SecurityError');
    });

    expect(takeDeletionNotice()).toBeNull();
  });
});

/* What the e2e suite found: the notice rode in the router's state, and the
   redirect PrivateRoute makes once the sign-out lands replaced it. React
   Router 7 makes a change of address a transition, so the sign-out renders
   first, on the old address. The real PrivateRoute, the real router, and
   the account and login pages as far as the notice goes. */
describe('the notice, across the redirect a sign-out sets off', () => {
  function Account() {
    const navigate = useNavigate();
    const deleteIt = async () => {
      await Promise.resolve(); // the request
      leaveDeletionNotice({ failures: ['r2'] }); // what accountService does, before:
      signOut();
      await Promise.resolve();
      navigate('/login', { replace: true });
    };
    return <button onClick={() => void deleteIt()}>Delete</button>;
  }

  function Login() {
    const [notice] = useState(takeDeletionNotice);
    return <p>{notice ? `Deleted; not erased: ${notice.failures.join(', ')}` : 'Nothing said'}</p>;
  }

  it('reaches the login page', async () => {
    render(
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route
            path="/account"
            element={
              <PrivateRoute>
                <Account />
              </PrivateRoute>
            }
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Delete'));

    expect(await screen.findByText('Deleted; not erased: r2')).toBeInTheDocument();
    await new Promise((settle) => setTimeout(settle, 50));
    expect(screen.getByText('Deleted; not erased: r2')).toBeInTheDocument();
  });
});
