import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFolderTrail } from './useFolderTrail';
import { withQueryClient } from '../test/utils';

const { getFolder, getFolderPath } = vi.hoisted(() => ({
  getFolder: vi.fn(),
  getFolderPath: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/storage.service', () => ({ default: { getFolder, getFolderPath } }));

const folder = (id: string, name: string) => ({ id, name, user_id: 'user-1' });

function show(folderId: string | undefined) {
  const { wrapper } = withQueryClient();
  return renderHook(() => useFolderTrail(folderId), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFolder.mockResolvedValue(null);
  getFolderPath.mockResolvedValue([]);
});

describe('useFolderTrail', () => {
  it('asks for nothing at the root, where there is nothing above', async () => {
    const { result } = show(undefined);
    await act(() => Promise.resolve());

    expect(getFolder).not.toHaveBeenCalled();
    expect(getFolderPath).not.toHaveBeenCalled();
    expect(result.current).toEqual({ folder: undefined, path: [], parentId: null });
  });

  it('names the folder it is in', async () => {
    getFolder.mockResolvedValue(folder('b', 'Invoices'));
    const { result } = show('b');

    await waitFor(() => expect(result.current.folder?.name).toBe('Invoices'));
    expect(getFolder).toHaveBeenCalledWith('b', 'user-1');
  });

  it('goes up to the root from the first level down', async () => {
    getFolderPath.mockResolvedValue([folder('a', 'Work')]);
    const { result } = show('a');

    await waitFor(() => expect(result.current.path).toHaveLength(1));
    expect(result.current.parentId).toBeNull();
  });

  /* The back button went to the root from any depth, which from two levels
     down is not "back". */
  it('goes up one level from further down, not to the root', async () => {
    getFolderPath.mockResolvedValue([
      folder('a', 'Work'),
      folder('b', 'Invoices'),
      folder('c', '2026'),
    ]);
    const { result } = show('c');

    await waitFor(() => expect(result.current.path).toHaveLength(3));
    expect(getFolderPath).toHaveBeenCalledWith('c', 'user-1');
    expect(result.current.parentId).toBe('b');
  });
});
