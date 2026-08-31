import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import UpgradeBanner from './UpgradeBanner';
import { renderWithProviders } from '../test/utils';

const { envMock } = vi.hoisted(() => ({ envMock: { VITE_BILLING_ENABLED: true } }));
vi.mock('../env', () => ({ env: envMock }));

const LIMIT = 500 * 1024 * 1024;

function show(props: { usedBytes: number; storageLimit?: number; tier?: string }) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<UpgradeBanner storageLimit={LIMIT} {...props} />} />
      <Route path="/pricing" element={<p>Plans</p>} />
    </Routes>
  );
}

describe('UpgradeBanner', () => {
  it('keeps quiet until the account is nearly full', () => {
    show({ usedBytes: LIMIT * 0.79 });
    expect(screen.queryByText(/storage/i)).not.toBeInTheDocument();
  });

  it('warns from four fifths of the plan onward', () => {
    show({ usedBytes: LIMIT * 0.8 });
    expect(screen.getByText('Running low on storage')).toBeInTheDocument();
  });

  it('changes its wording once nothing more will fit', () => {
    show({ usedBytes: LIMIT });
    expect(screen.getByText('Storage full!')).toBeInTheDocument();
  });

  it('has nothing to sell a Pro account', () => {
    show({ usedBytes: LIMIT, tier: 'pro' });
    expect(screen.queryByText('Storage full!')).not.toBeInTheDocument();
  });

  it('survives a limit of zero without dividing by it', () => {
    // A profile row that never got a limit would otherwise put NaN through the
    // comparison and hide the banner by accident rather than by decision.
    show({ usedBytes: 10, storageLimit: 0 });
    expect(screen.queryByText(/storage/i)).not.toBeInTheDocument();
  });

  it('leads to the plans page', () => {
    show({ usedBytes: LIMIT });
    fireEvent.click(screen.getByText('Upgrade'));
    expect(screen.getByText('Plans')).toBeInTheDocument();
  });

  it('stays hidden where Stripe is not configured', () => {
    envMock.VITE_BILLING_ENABLED = false;
    try {
      show({ usedBytes: LIMIT });
      expect(screen.queryByText('Storage full!')).not.toBeInTheDocument();
    } finally {
      envMock.VITE_BILLING_ENABLED = true;
    }
  });
});
