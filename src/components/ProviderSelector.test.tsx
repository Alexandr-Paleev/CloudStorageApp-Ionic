import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProviderSelector from './ProviderSelector';

const EVERYTHING = ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'];
const FREE = ['cloudinary', 'r2', 'supabase_storage'];
/* As production has it: R2 switched off, Dropbox never set up. */
const PRODUCTION = ['cloudinary', 'supabase_storage', 'googledrive'];

const button = (name: string) => screen.getByRole('button', { name });

describe('ProviderSelector', () => {
  it('offers what this deployment has, and nothing it does not', () => {
    render(
      <ProviderSelector
        selectedProvider={undefined}
        allowedProviders={EVERYTHING}
        configuredProviders={PRODUCTION}
        onSelect={vi.fn()}
      />
    );

    for (const name of ['Auto', 'Cloudinary', 'Supabase', 'Google Drive']) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Cloudflare R2')).toBeNull();
    expect(screen.queryByText('Dropbox')).toBeNull();
  });

  it('does not select a backend the plan does not include', () => {
    // The client-side half of the gate. The other half is in
    // ProviderManager.selectProvider, which refuses the same choice even if
    // this button is somehow pressed — neither is trusted on its own.
    const onSelect = vi.fn();
    render(
      <ProviderSelector
        selectedProvider={undefined}
        allowedProviders={FREE}
        configuredProviders={EVERYTHING}
        onSelect={onSelect}
      />
    );

    expect(button('Dropbox')).toBeDisabled();
    fireEvent.click(button('Dropbox'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(button('Cloudflare R2'));
    expect(onSelect).toHaveBeenCalledWith('r2');
  });

  /* They were ion-chips with a click handler: no role and no tabindex, so a
     keyboard could not reach them and a screen reader called them nothing. */
  it('is a set of buttons that say which one is pressed', () => {
    render(
      <ProviderSelector
        selectedProvider="supabase_storage"
        allowedProviders={EVERYTHING}
        configuredProviders={PRODUCTION}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('group', { name: 'Upload to:' })).toBeInTheDocument();
    expect(button('Supabase')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Auto')).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['Auto', 'Cloudinary', 'Supabase', 'Google Drive']) {
      expect(button(name).tagName).toBe('BUTTON');
    }
  });

  it('goes back to automatic selection', () => {
    const onSelect = vi.fn();
    render(
      <ProviderSelector
        selectedProvider="cloudinary"
        allowedProviders={EVERYTHING}
        configuredProviders={PRODUCTION}
        onSelect={onSelect}
      />
    );

    fireEvent.click(button('Auto'));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
