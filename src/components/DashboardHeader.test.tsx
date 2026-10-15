import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { rocketOutline, star } from 'ionicons/icons';
import DashboardHeader from './DashboardHeader';
import { renderWithProviders } from '../test/utils';

const { envMock, isNativePlatform, logout } = vi.hoisted(() => ({
  envMock: { VITE_BILLING_ENABLED: true },
  isNativePlatform: vi.fn(() => false),
  logout: vi.fn(),
}));
vi.mock('../env', () => ({ env: envMock }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ logout }) }));

function show(props: Partial<React.ComponentProps<typeof DashboardHeader>> = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<DashboardHeader title="My Files" {...props} />} />
      <Route path="/pricing" element={<p>Plans page</p>} />
      <Route path="/account" element={<p>Account page</p>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>
  );
}

/** Ionic's props are properties of the element, not attributes. */
const iconOf = (button: HTMLElement) =>
  (button.querySelector('ion-icon') as unknown as { icon?: string }).icon;

beforeEach(() => {
  vi.clearAllMocks();
  envMock.VITE_BILLING_ENABLED = true;
  isNativePlatform.mockReturnValue(false);
  logout.mockResolvedValue(undefined);
});

describe('DashboardHeader', () => {
  it('says what it is given', () => {
    show({ title: 'Invoices' });
    expect(document.querySelector('ion-title')).toHaveTextContent('Invoices');
  });

  describe('the way up', () => {
    it('is not offered at the root, where there is nothing above', () => {
      show();
      expect(screen.queryByLabelText('Up one folder')).not.toBeInTheDocument();
    });

    it('goes where the page says is up', () => {
      const onUp = vi.fn();
      show({ onUp });

      fireEvent.click(screen.getByLabelText('Up one folder'));
      expect(onUp).toHaveBeenCalledOnce();
    });
  });

  describe('the way into billing', () => {
    it('offers the plans to an account without one', () => {
      show({ tier: 'free' });

      const button = screen.getByTestId('pricing-link');
      expect(button).toHaveAttribute('aria-label', 'Plans');
      expect(iconOf(button)).toBe(rocketOutline);
    });

    /* The same button, because a Pro account's way to the customer portal
       goes through the plans page too. */
    it('offers a Pro account its subscription instead', () => {
      show({ tier: 'pro' });

      const button = screen.getByTestId('pricing-link');
      expect(button).toHaveAttribute('aria-label', 'Manage subscription');
      expect(iconOf(button)).toBe(star);
    });

    it('leads to the plans page', () => {
      show();
      fireEvent.click(screen.getByTestId('pricing-link'));
      expect(screen.getByText('Plans page')).toBeInTheDocument();
    });

    it('is not there where Stripe is not configured', () => {
      envMock.VITE_BILLING_ENABLED = false;
      show();
      expect(screen.queryByTestId('pricing-link')).not.toBeInTheDocument();
    });

    it('is not there in the native shell, which sells nothing', () => {
      isNativePlatform.mockReturnValue(true);
      show();
      expect(screen.queryByTestId('pricing-link')).not.toBeInTheDocument();
    });
  });

  /* Both stores want account deletion findable without being told where it
     is, so the way to it is on the page every session starts on. */
  it('leads to the account page, in the shell as well', () => {
    isNativePlatform.mockReturnValue(true);
    show();

    fireEvent.click(screen.getByTestId('account-link'));
    expect(screen.getByText('Account page')).toBeInTheDocument();
  });

  it('signs out, and only then goes to the login page', async () => {
    let signedOut!: () => void;
    logout.mockReturnValue(new Promise<void>((resolve) => (signedOut = resolve)));
    show();

    fireEvent.click(screen.getByLabelText('Sign out'));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();

    await act(async () => signedOut());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });
});
