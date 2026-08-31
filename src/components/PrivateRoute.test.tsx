import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import PrivateRoute from './PrivateRoute';
import { useAuth } from '../contexts/AuthContext';
import { renderWithProviders } from '../test/utils';

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

function signedIn(user: User | null, loading = false) {
  vi.mocked(useAuth).mockReturnValue({
    user,
    loading,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>Sign in</p>} />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <p>Your files</p>
          </PrivateRoute>
        }
      />
    </Routes>,
    { route: '/dashboard' }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PrivateRoute', () => {
  it('waits instead of guessing while the session is still loading', () => {
    // The window that matters: on a reload Supabase has not answered yet, and
    // treating "no user yet" as "not signed in" would bounce the user to the
    // login page on every refresh.
    signedIn(null, true);
    const { container } = renderGuarded();

    expect(container.querySelector('ion-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Your files')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login page', () => {
    signedIn(null);
    renderGuarded();

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText('Your files')).not.toBeInTheDocument();
  });

  it('renders the page for a signed-in user', () => {
    signedIn({ id: 'user-1' } as User);
    renderGuarded();

    expect(screen.getByText('Your files')).toBeInTheDocument();
  });
});
