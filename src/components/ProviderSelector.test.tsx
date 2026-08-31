import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProviderSelector from './ProviderSelector';

const FREE = ['cloudinary', 'r2', 'supabase_storage'];

describe('ProviderSelector', () => {
  it('offers every backend, locked or not', () => {
    render(
      <ProviderSelector selectedProvider={undefined} allowedProviders={FREE} onSelect={vi.fn()} />
    );

    for (const label of [
      'Auto',
      'Cloudinary',
      'Cloudflare R2',
      'Supabase',
      'Google Drive',
      'Dropbox',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not select a backend the plan does not include', () => {
    // The client-side half of the gate. The other half is in
    // ProviderManager.selectProvider, which refuses the same choice even if
    // this chip is somehow clicked — neither is trusted on its own.
    const onSelect = vi.fn();
    render(
      <ProviderSelector selectedProvider={undefined} allowedProviders={FREE} onSelect={onSelect} />
    );

    fireEvent.click(screen.getByText('Dropbox'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cloudflare R2'));
    expect(onSelect).toHaveBeenCalledWith('r2');
  });

  it('goes back to automatic selection', () => {
    const onSelect = vi.fn();
    render(<ProviderSelector selectedProvider="r2" allowedProviders={FREE} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Auto'));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
