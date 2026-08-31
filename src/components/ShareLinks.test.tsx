import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import ShareLinks from './ShareLinks';
import shareService, { type ShareLinkRecord } from '../services/share.service';
import { renderWithProviders } from '../test/utils';

vi.mock('../services/share.service', () => ({
  default: { listLinks: vi.fn(), revokeLink: vi.fn() },
}));

const HOUR = 60 * 60 * 1000;

function link(overrides: Partial<ShareLinkRecord> & { id: string }): ShareLinkRecord {
  return {
    created_at: new Date(Date.now() - 24 * HOUR).toISOString(),
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

const links: ShareLinkRecord[] = [
  link({ id: 'never-expires' }),
  link({ id: 'still-valid', expires_at: new Date(Date.now() + HOUR).toISOString() }),
  link({ id: 'ran-out', expires_at: new Date(Date.now() - HOUR).toISOString() }),
  link({ id: 'taken-back', revoked_at: new Date(Date.now() - HOUR).toISOString() }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShareLinks', () => {
  it('stays out of the way when the file was never shared', async () => {
    vi.mocked(shareService.listLinks).mockResolvedValue([]);

    const { container } = renderWithProviders(<ShareLinks fileId="file-1" />);

    await waitFor(() => expect(container.querySelector('.share-links')).not.toBeInTheDocument());
  });

  it('separates a link that still works from one that no longer does', async () => {
    // stateOf() deliberately re-implements shareUnusableReason() from lib/share
    // rather than importing it — that module pulls node:crypto in. Which means
    // the two can drift, and only a test on this side would notice.
    vi.mocked(shareService.listLinks).mockResolvedValue(links);

    renderWithProviders(<ShareLinks fileId="file-1" />);

    await waitFor(() => expect(screen.getAllByText('Active')).toHaveLength(2));
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it('offers to revoke only what is still live', async () => {
    vi.mocked(shareService.listLinks).mockResolvedValue(links);

    renderWithProviders(<ShareLinks fileId="file-1" />);

    await waitFor(() => expect(screen.getAllByText('Revoke')).toHaveLength(2));
  });

  it('re-reads the list after a revoke, so the badge actually changes', async () => {
    vi.mocked(shareService.listLinks).mockResolvedValue([link({ id: 'still-valid' })]);
    vi.mocked(shareService.revokeLink).mockResolvedValue(undefined);

    renderWithProviders(<ShareLinks fileId="file-1" />);
    fireEvent.click(await screen.findByText('Revoke'));

    await waitFor(() => expect(shareService.revokeLink).toHaveBeenCalledWith('still-valid'));
    await waitFor(() => expect(shareService.listLinks).toHaveBeenCalledTimes(2));
  });

  it('tells the owner when the revoke did not go through', async () => {
    vi.mocked(shareService.listLinks).mockResolvedValue([link({ id: 'still-valid' })]);
    vi.mocked(shareService.revokeLink).mockRejectedValue(new Error('Link not found'));

    renderWithProviders(<ShareLinks fileId="file-1" />);
    fireEvent.click(await screen.findByText('Revoke'));

    expect(await screen.findByText('Link not found')).toBeInTheDocument();
  });
});
