import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FolderGrid from './FolderGrid';
import type { Folder } from '../services/storage.service';
import { whereHotjarWouldRead } from '../test/hotjar';

const folder = (id: string, name: string): Folder =>
  ({ id, name, parent_id: null, user_id: 'user-1' }) as Folder;

const WORK = folder('a', 'Work');
const INVOICES = folder('b', 'Invoices');

function show(folders: Folder[]) {
  const onOpen = vi.fn();
  const onActions = vi.fn();
  render(<FolderGrid folders={folders} onOpen={onOpen} onActions={onActions} />);
  return { onOpen, onActions };
}

describe('FolderGrid', () => {
  it('draws no section at all when there are no folders', () => {
    show([]);
    expect(screen.queryByText('Folders')).not.toBeInTheDocument();
  });

  it('draws a card for each folder, in the order it is given', () => {
    show([WORK, INVOICES]);

    const names = [...document.querySelectorAll('.folder-card .folder-name')].map(
      (name) => name.textContent
    );
    expect(names).toEqual(['Work', 'Invoices']);
  });

  it('opens the folder whose card was pressed', () => {
    const { onOpen, onActions } = show([WORK, INVOICES]);

    fireEvent.click(screen.getByRole('button', { name: 'Open Invoices' }));
    expect(onOpen).toHaveBeenCalledWith(INVOICES);
    expect(onActions).not.toHaveBeenCalled();
  });

  /* The menu sits on the card. Pressing it must not also open the folder it
     belongs to. */
  it('opens the menu of that folder, and not the folder', () => {
    const { onOpen, onActions } = show([WORK, INVOICES]);

    fireEvent.click(screen.getByText('Actions for Work'));
    expect(onActions).toHaveBeenCalledWith(WORK);
    expect(onOpen).not.toHaveBeenCalled();
  });

  /* The end-to-end suite finds a folder's menu by this id. */
  it('gives each menu button an id of its folder', () => {
    show([WORK]);
    expect(screen.getByTestId('folder-actions-a')).toHaveTextContent('Actions for Work');
  });
});

/* The card says the name three times: on it, and to a screen reader on its two
   buttons. Hotjar must read it in none of them. */
describe('FolderGrid and what Hotjar may record', () => {
  it('shows it no folder name', () => {
    show([WORK, INVOICES]);
    expect(whereHotjarWouldRead('Work')).toEqual([]);
    expect(whereHotjarWouldRead('Invoices')).toEqual([]);
  });
});
