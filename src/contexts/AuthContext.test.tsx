import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';
import { authService } from '../services/auth.service';

vi.mock('../services/auth.service', () => ({
  authService: {
    onAuthStateChanged: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

const unsubscribe = vi.fn();
let emit: (user: User | null) => void;

function Probe() {
  const { user, loading, login, logout } = useAuth();

  return (
    <>
      <span data-testid="state">{loading ? 'loading' : (user?.id ?? 'anonymous')}</span>
      <button onClick={() => login('user@example.com', 'password')}>sign in</button>
      <button onClick={() => logout()}>sign out</button>
    </>
  );
}

function state() {
  return screen.getByTestId('state').textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authService.onAuthStateChanged).mockImplementation((callback) => {
    emit = callback;
    return unsubscribe;
  });
});

describe('AuthProvider', () => {
  it('claims nothing until Supabase has answered', () => {
    // Every guarded route reads `loading`; starting at "signed out" instead
    // would redirect the user on every page load.
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(state()).toBe('loading');
  });

  it('follows the session in and out', () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    act(() => emit({ id: 'user-1' } as User));
    expect(state()).toBe('user-1');

    act(() => emit(null));
    expect(state()).toBe('anonymous');
  });

  it('lets go of the subscription when it unmounts', () => {
    // Supabase keeps the listener otherwise, and it calls setState on a
    // component that is gone — the classic React memory leak.
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('passes credentials straight through to the auth service', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText('sign in'));
    await waitFor(() =>
      expect(authService.login).toHaveBeenCalledWith('user@example.com', 'password')
    );

    fireEvent.click(screen.getByText('sign out'));
    await waitFor(() => expect(authService.logout).toHaveBeenCalled());
  });
});

describe('useAuth', () => {
  it('refuses to be used outside the provider', () => {
    // Without the guard the hook would return undefined and the caller would
    // read `.user` off it — a crash three files away from the mistake.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow(/must be used within an AuthProvider/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
