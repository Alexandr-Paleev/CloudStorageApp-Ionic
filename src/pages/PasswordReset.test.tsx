import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import PasswordReset from './PasswordReset';

const { requestLink, setNewPassword, navigate, auth } = vi.hoisted(() => ({
  requestLink: vi.fn(),
  setNewPassword: vi.fn(),
  navigate: vi.fn(),
  auth: { current: { user: null as unknown, loading: false } },
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth.current }));

vi.mock('../services/password-reset.service', () => ({
  passwordResetService: {
    requestLink: (...a: unknown[]) => requestLink(...a),
    setNewPassword: (...a: unknown[]) => setNewPassword(...a),
  },
}));

vi.mock('../native/shell', () => ({
  setStatusBarForDarkBackground: vi.fn(),
  syncStatusBarStyle: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate };
});

function show(step: 'ask' | 'choose', state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/here', state }]}>
      <Routes>
        <Route path="/here" element={<PasswordReset step={step} />} />
      </Routes>
    </MemoryRouter>
  );
}

function input(placeholder: string): HTMLElement & { value?: string } {
  return [...document.querySelectorAll('ion-input')].find(
    (i) => (i as HTMLElement & { placeholder?: string }).placeholder === placeholder
  ) as HTMLElement & { value?: string };
}

/** As the login page's tests type: through Ionic's own event, on the host. */
function type(placeholder: string, value: string) {
  fireEvent(input(placeholder), new CustomEvent('ionInput', { detail: { value } }));
}

function submit() {
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);
}

function ionButton(text: string): HTMLElement {
  return [...document.querySelectorAll('ion-button')].find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.current = { user: null, loading: false };
  requestLink.mockResolvedValue(undefined);
  setNewPassword.mockResolvedValue(undefined);
});

describe('asking for a link', () => {
  it('starts from the address typed on the login page', () => {
    show('ask', { email: 'a@example.com' });
    expect(input('Email Address').value).toBe('a@example.com');
  });

  it('starts empty when it was not given one', () => {
    show('ask');
    expect(input('Email Address').value).toBe('');
  });

  /* Supabase answers the same for an address with no account, so the page
     cannot say a link was sent, only that it was if there is an account. */
  it('asks for the link, and says it is on its way if there is an account', async () => {
    show('ask');
    type('Email Address', 'a@example.com');
    submit();

    await waitFor(() => expect(requestLink).toHaveBeenCalledWith('a@example.com'));
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('If a@example.com has an account here'));
  });

  it('says why when it cannot be sent, and says nothing was', async () => {
    requestLink.mockRejectedValue(new Error('email rate limit exceeded'));
    show('ask');
    type('Email Address', 'a@example.com');
    submit();

    expect(await screen.findByText('email rate limit exceeded')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('leads back to signing in', () => {
    show('ask');
    fireEvent.click(ionButton('Back to sign in'));
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  /* Supabase quotes the address in some refusals, and the field holds it. */
  it('keeps the address out of what Hotjar records', async () => {
    requestLink.mockRejectedValue(new Error('Email address "a@example.com" is invalid'));
    show('ask');
    type('Email Address', 'a@example.com');
    submit();

    const problem = await screen.findByText('Email address "a@example.com" is invalid');
    expect(problem.closest('[data-hj-suppress]')).not.toBeNull();
    expect(input('Email Address')).toHaveAttribute('data-hj-suppress');
  });
});

describe('choosing the new password', () => {
  const signedIn = () => {
    auth.current = { user: { id: 'user-1', email: 'a@example.com' }, loading: false };
  };

  /* The link's session is read while the client starts. Until then there is
     no telling a good link from a spent one. */
  it('waits while the session is being read', () => {
    auth.current = { user: null, loading: true };
    show('choose');

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });

  it('offers a new link when the one it came from was spent', () => {
    show('choose');

    expect(screen.getByText(/This link has run out or has been used already/)).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    fireEvent.click(ionButton('Send a new link'));
    expect(navigate).toHaveBeenCalledWith('/forgot-password', { replace: true });
  });

  it('says which account the password is for', () => {
    signedIn();
    show('choose');
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
  });

  it('saves the new password and goes on to the dashboard', async () => {
    signedIn();
    show('choose');
    type('New password', 'a long new password');
    type('The new password again', 'a long new password');
    submit();

    await waitFor(() => expect(setNewPassword).toHaveBeenCalledWith('a long new password'));
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('refuses two different passwords before asking anyone', async () => {
    signedIn();
    show('choose');
    type('New password', 'a long new password');
    type('The new password again', 'a long new pasword');
    submit();

    expect(await screen.findByText('The two passwords are not the same.')).toBeInTheDocument();
    expect(setNewPassword).not.toHaveBeenCalled();
  });

  it('says why a password was refused, and lets it be tried again', async () => {
    setNewPassword.mockRejectedValue(new Error('Password should be at least 6 characters.'));
    signedIn();
    show('choose');
    type('New password', 'short');
    type('The new password again', 'short');
    submit();

    expect(
      await screen.findByText('Password should be at least 6 characters.')
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(ionButton('Save password')).not.toHaveAttribute('disabled');
  });

  it('keeps both fields out of what Hotjar records', () => {
    signedIn();
    show('choose');

    for (const field of document.querySelectorAll('ion-input')) {
      expect(field).toHaveAttribute('data-hj-suppress');
    }
  });
});
