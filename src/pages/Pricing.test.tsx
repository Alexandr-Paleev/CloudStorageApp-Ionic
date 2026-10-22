import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { checkmarkCircle } from 'ionicons/icons';
import { PLANS } from '@cloud-storage/core/plans';
import Pricing from './Pricing';
import { renderWithProviders } from '../test/utils';
import { SubscriptionExistsError } from '../services/billing.service';
import { LEGAL_URL } from '../utils/legal.utils';

const { createCheckoutSession, createPortalSession, profileMock, envMock, isNativePlatform } =
  vi.hoisted(() => ({
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    profileMock: {
      current: { tier: 'free' } as Record<string, unknown> | null,
      isLoading: false,
    },
    envMock: { VITE_BILLING_ENABLED: true, VITE_BILLING_DEMO_MODE: false },
    isNativePlatform: vi.fn(() => false),
  }));

/* The real module creates the Supabase client as it loads. The page tells
   one refusal from the others by its class, so the mock brings its own. */
vi.mock('../services/billing.service', () => ({
  default: {
    createCheckoutSession: () => createCheckoutSession(),
    createPortalSession: () => createPortalSession(),
  },
  SubscriptionExistsError: class SubscriptionExistsError extends Error {},
}));

vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({
    profile: profileMock.current,
    isLoading: profileMock.isLoading,
    error: null,
  }),
}));

vi.mock('../env', () => ({ env: envMock }));

/* The real billingIsOffered() runs on top of both of these — mocking the
   predicate itself would test the mock rather than the rule it encodes. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Pricing />} />
      <Route path="/dashboard" element={<p>Dashboard</p>} />
    </Routes>
  );
}

/** The card a plan's name heads. */
const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('.pricing-card') as HTMLElement;

/** Ionic's props are properties of the element, not attributes. */
const iconOf = (line: HTMLElement) =>
  (line.closest('li')!.querySelector('ion-icon') as unknown as { icon?: string }).icon;

beforeEach(() => {
  vi.clearAllMocks();
  profileMock.current = { tier: 'free' };
  profileMock.isLoading = false;
  envMock.VITE_BILLING_ENABLED = true;
  envMock.VITE_BILLING_DEMO_MODE = false;
  isNativePlatform.mockReturnValue(false);
  window.history.replaceState(null, '', '/');
});

describe('Pricing', () => {
  it('offers a free account Pro, and shows Free as its plan', () => {
    show();

    expect(within(card('Free')).getByText('Current Plan')).toBeInTheDocument();
    expect(within(card('Pro')).getByText('Upgrade to Pro')).toBeInTheDocument();
    expect(screen.queryByText('Manage Subscription')).not.toBeInTheDocument();
  });

  it('offers a Pro account the portal rather than a second subscription', () => {
    profileMock.current = { tier: 'pro' };
    show();

    expect(within(card('Pro')).getByText('Manage Subscription')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Plan')).not.toBeInTheDocument();
  });

  it('puts a check beside what a plan gives, and none beside what is coming', () => {
    show();

    for (const plan of [PLANS.free, PLANS.pro]) {
      for (const feature of plan.features) {
        expect(iconOf(within(card(plan.name)).getByText(feature))).toBe(checkmarkCircle);
      }
    }
    const dropbox = within(card('Pro')).getByText('Dropbox (coming soon)');
    expect(iconOf(dropbox)).not.toBe(checkmarkCircle);
  });

  it('sends a free account to the checkout Stripe opens for it', async () => {
    // jsdom navigates only within the page, so the address the service
    // answers with is a fragment, and arriving at it is what is checked.
    createCheckoutSession.mockResolvedValue('#checkout');
    show();

    fireEvent.click(screen.getByText('Upgrade to Pro'));

    await waitFor(() => expect(window.location.hash).toBe('#checkout'));
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('opens the portal when Stripe holds a subscription the profile has not caught up with', async () => {
    createCheckoutSession.mockRejectedValue(new SubscriptionExistsError());
    createPortalSession.mockResolvedValue('#portal');
    show();

    fireEvent.click(screen.getByText('Upgrade to Pro'));

    await waitFor(() => expect(window.location.hash).toBe('#portal'));
  });

  it('says why checkout did not start, and offers it again', async () => {
    createCheckoutSession.mockRejectedValue(new Error('Stripe is not configured'));
    show();

    fireEvent.click(screen.getByText('Upgrade to Pro'));

    expect(await screen.findByText('Stripe is not configured')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
  });

  it('says why the portal did not open', async () => {
    profileMock.current = { tier: 'pro' };
    createPortalSession.mockRejectedValue(new Error('No customer for this account'));
    show();

    fireEvent.click(screen.getByText('Manage Subscription'));

    expect(await screen.findByText('No customer for this account')).toBeInTheDocument();
  });

  it('waits for the profile before saying which plan is current', () => {
    profileMock.isLoading = true;
    show();

    expect(screen.getByLabelText('Loading plans')).toBeInTheDocument();
    expect(screen.queryByText('Current Plan')).not.toBeInTheDocument();
  });

  it('gives the test card where Stripe runs on test keys, and only there', () => {
    show();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    envMock.VITE_BILLING_DEMO_MODE = true;
    show();
    expect(screen.getByRole('note')).toHaveTextContent('4242 4242 4242 4242');
  });

  it('links the terms and the privacy policy before anyone pays', () => {
    show();

    expect(screen.getByText('Terms of Service')).toHaveAttribute('href', LEGAL_URL.terms);
    expect(screen.getByText('Privacy Policy')).toHaveAttribute('href', LEGAL_URL.privacy);
  });

  it('sends the visitor to the dashboard where billing is switched off', () => {
    envMock.VITE_BILLING_ENABLED = false;
    show();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Choose your plan')).not.toBeInTheDocument();
  });

  it('sends the visitor to the dashboard inside the native shell', () => {
    /* App Store 3.1.1 forbids a route to a purchase made anywhere but
       In-App Purchase. See ADR 0012. */
    isNativePlatform.mockReturnValue(true);
    show();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Choose your plan')).not.toBeInTheDocument();
  });
});
