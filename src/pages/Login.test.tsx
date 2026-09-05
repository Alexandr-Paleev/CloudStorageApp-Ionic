import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import Login from './Login';
import { renderWithProviders } from '../test/utils';

/**
 * The four ways into this app, and what each of them does when it fails.
 *
 * `Login.tsx` is the only page an unauthenticated visitor ever sees, and until
 * now the only thing asserted about it was its layout: an e2e test measures it
 * at 1440×720 because a card 799px tall does not fit a laptop. Nothing checked
 * what it does with a wrong password.
 */

const { login, register, demoStart, signInWithGoogle, navigate, user } = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  demoStart: vi.fn(),
  signInWithGoogle: vi.fn(),
  navigate: vi.fn(),
  user: { current: null as unknown },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login, register, user: user.current }),
}));

vi.mock('../services/demo.service', () => ({
  default: { start: (...a: unknown[]) => demoStart(...a) },
}));
vi.mock('../services/auth.service', () => ({
  authService: { signInWithGoogle: (...a: unknown[]) => signInWithGoogle(...a) },
}));

vi.mock('../env', () => ({ env: { VITE_DEMO_ENABLED: true, VITE_BILLING_ENABLED: false } }));

vi.mock('../native/shell', () => ({
  setStatusBarForDarkBackground: vi.fn(),
  syncStatusBarStyle: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Login />} />
    </Routes>
  );
}

/** Ionic inputs report through their own event, and the native <input> inside
 *  the host is what a browser would type into — the e2e suite learned the same
 *  thing on Ionic 9, where `ion-input[type=email]` matches nothing. */
function type(placeholder: string, value: string) {
  const host = [...document.querySelectorAll('ion-input')].find(
    (i) => (i as HTMLElement & { placeholder?: string }).placeholder === placeholder
  ) as HTMLElement;
  fireEvent(host, new CustomEvent('ionInput', { detail: { value } }));
}

function submit() {
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);
}

function ionButtonByText(text: string): HTMLElement {
  return [...document.querySelectorAll('ion-button')].find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  user.current = null;
  login.mockResolvedValue(undefined);
  register.mockResolvedValue(undefined);
  demoStart.mockResolvedValue(undefined);
});

describe('Login', () => {
  it('signs in with what was typed, and leaves for the dashboard', async () => {
    show();
    type('Email Address', 'someone@example.com');
    type('Password', 'correct horse');
    submit();

    await waitFor(() => expect(login).toHaveBeenCalledWith('someone@example.com', 'correct horse'));
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  /* The failure that matters: a wrong password must say so and leave the
     visitor on the form with what they typed still in it. */
  it('stays put and reports why when the password is wrong', async () => {
    login.mockRejectedValue(new Error('Invalid login credentials'));

    show();
    type('Email Address', 'someone@example.com');
    type('Password', 'wrong');
    submit();

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('registers instead of signing in once the mode is switched', async () => {
    show();
    fireEvent.click(screen.getByText(/Sign up/i));

    type('Email Address', 'new@example.com');
    type('Password', 'a new password');
    submit();

    await waitFor(() => expect(register).toHaveBeenCalledWith('new@example.com', 'a new password'));
    expect(login).not.toHaveBeenCalled();
  });

  describe('the demo account', () => {
    it('opens one and goes straight to the dashboard', async () => {
      show();
      fireEvent.click(ionButtonByText('demo account'));

      await waitFor(() => expect(demoStart).toHaveBeenCalled());
      expect(navigate).toHaveBeenCalledWith('/dashboard');
    });

    /* The demo is the first thing a visitor with ninety seconds touches, so a
       refusal has to be legible rather than a button that does nothing. */
    it('says why when the endpoint refuses', async () => {
      demoStart.mockRejectedValue(new Error('Too many demo sessions. Try again later.'));

      show();
      fireEvent.click(ionButtonByText('demo account'));

      expect(await screen.findByText(/Too many demo sessions/)).toBeInTheDocument();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  /* Either request in flight locks the card: two sessions opened at once would
     race to write the same auth store. */
  it('locks the card while a request is in flight', async () => {
    let release: () => void = () => undefined;
    demoStart.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    show();
    fireEvent.click(ionButtonByText('demo account'));

    await waitFor(() => {
      const submitButton = document.querySelector('ion-button[type="submit"]') as HTMLElement & {
        disabled?: boolean;
      };
      expect(submitButton?.disabled).toBe(true);
    });

    release();
  });

  it('sends an already-signed-in visitor away rather than showing the form', () => {
    user.current = { id: 'user-1' };
    show();
    expect(document.querySelector('form')).toBeNull();
  });
});
