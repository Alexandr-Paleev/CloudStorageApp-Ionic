import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FolderActions from './FolderActions';
import type { Folder } from '../services/storage.service';
import { choose, dismiss, overlay, overlays, press } from '../test/overlays';
import { whereHotjarWouldRead } from '../test/hotjar';

const WORK = { id: 'a', name: 'Work', parent_id: null, user_id: 'user-1' } as Folder;

/** The page's part: it knows which folder's menu is open, and nothing more. */
function Page({
  onClose,
  onRename,
  onDelete,
}: {
  onClose: () => void;
  onRename: (folder: Folder, name: string) => void;
  onDelete: (folder: Folder) => void;
}) {
  const [folder, setFolder] = useState<Folder | null>(null);

  return (
    <>
      <button type="button" onClick={() => setFolder(WORK)}>
        menu
      </button>
      <FolderActions
        folder={folder}
        onClose={() => {
          onClose();
          setFolder(null);
        }}
        onRename={onRename}
        onDelete={onDelete}
      />
    </>
  );
}

function show() {
  const spies = { onClose: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
  const view = render(<Page {...spies} />);
  return { ...spies, renderAgain: () => view.rerender(<Page {...spies} />) };
}

const openMenu = () => fireEvent.click(screen.getByText('menu'));
const menu = () => overlays('ion-action-sheet')[0]!;
const renameDialog = () => overlay('ion-alert', 'Rename folder');
const deleteDialog = () => overlay('ion-alert', 'Delete folder?');

describe('FolderActions', () => {
  it('shows nothing until a folder’s menu is asked for', () => {
    show();

    expect(menu().isOpen).toBe(false);
    expect(renameDialog().isOpen).toBe(false);
    expect(deleteDialog().isOpen).toBe(false);
  });

  it('opens the menu under the folder’s name', () => {
    show();
    openMenu();

    expect(menu().isOpen).toBe(true);
    expect(menu().header).toBe('Work');
  });

  it('tells the page when the menu has gone', () => {
    const { onClose } = show();
    openMenu();
    press(menu(), 'Cancel');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(menu().isOpen).toBe(false);
  });

  it('opens no dialog when the menu is closed without a choice', () => {
    show();
    openMenu();
    press(menu(), 'Cancel');

    expect(renameDialog().isOpen).toBe(false);
    expect(deleteDialog().isOpen).toBe(false);
  });

  /* Ionic presents one overlay at a time. A dialog asked for while the sheet
     is still on its way out never appears, and the choice is lost with it. */
  it.each([
    ['Rename', renameDialog],
    ['Delete', deleteDialog],
  ] as const)('opens the dialog for %s only once the menu has gone', (text, dialog) => {
    show();
    openMenu();

    choose(menu(), text);
    expect(dialog().isOpen).toBe(false);

    dismiss(menu());
    expect(dialog().isOpen).toBe(true);
  });

  describe('renaming', () => {
    function askToRename() {
      const spies = show();
      openMenu();
      press(menu(), 'Rename');
      return spies;
    }

    it('starts from the name the folder has', () => {
      askToRename();

      expect(renameDialog().inputs).toEqual([
        { name: 'name', type: 'text', value: 'Work', placeholder: 'Folder name' },
      ]);
    });

    it('hands over the folder and what was typed, trimmed', () => {
      const { onRename } = askToRename();
      press(renameDialog(), 'Save', { name: '  Invoices ' });

      expect(onRename).toHaveBeenCalledWith(WORK, 'Invoices');
      expect(renameDialog().isOpen).toBe(false);
    });

    it.each([
      ['nothing', { name: '' }],
      ['spaces', { name: '   ' }],
      ['the name it already has', { name: 'Work' }],
      ['the name it already has, with spaces around it', { name: ' Work ' }],
      ['no field at all', {}],
    ])('does not rename to %s', (_what, typed) => {
      const { onRename } = askToRename();
      press(renameDialog(), 'Save', typed);

      expect(onRename).not.toHaveBeenCalled();
    });

    it('renames nothing when cancelled', () => {
      const { onRename } = askToRename();
      press(renameDialog(), 'Cancel');

      expect(onRename).not.toHaveBeenCalled();
      expect(renameDialog().isOpen).toBe(false);
    });

    /* What has been typed lives in the alert's fields, and Ionic rebuilds
       them whenever it is given a different array. A new one on every render
       wiped the typing while the dialog was open: see NewFolderDialog. */
    it('gives the dialog the same fields for as long as one name is being edited', () => {
      const { renderAgain } = askToRename();
      const fields = renameDialog().inputs;

      // Any render of the page: a query settling, say.
      renderAgain();

      expect(renameDialog().inputs).toBe(fields);
    });
  });

  describe('deleting', () => {
    function askToDelete() {
      const spies = show();
      openMenu();
      press(menu(), 'Delete');
      return spies;
    }

    /* More goes than was clicked: every file inside, and every folder below. */
    it('says which folder, and that everything inside goes with it', () => {
      const { onDelete } = askToDelete();

      expect(deleteDialog().message).toContain('“Work”');
      expect(deleteDialog().message).toContain('files and subfolders');
      expect(deleteDialog().message).toContain('cannot be undone');
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('deletes once the person has said yes', () => {
      const { onDelete } = askToDelete();
      press(deleteDialog(), 'Delete');

      expect(onDelete).toHaveBeenCalledWith(WORK);
      expect(deleteDialog().isOpen).toBe(false);
    });

    it('deletes nothing when cancelled', () => {
      const { onDelete } = askToDelete();
      press(deleteDialog(), 'Cancel');

      expect(onDelete).not.toHaveBeenCalled();
      expect(deleteDialog().isOpen).toBe(false);
    });
  });

  it('does not carry a choice over to the next time the menu is opened', () => {
    const { onRename } = show();
    openMenu();
    press(menu(), 'Rename');
    press(renameDialog(), 'Cancel');

    openMenu();
    press(menu(), 'Cancel');

    expect(renameDialog().isOpen).toBe(false);
    expect(onRename).not.toHaveBeenCalled();
  });
});

/* The folder's name is in the menu's header, the deletion's message and the
   rename's field. Hotjar must read it in none of them: not as text, and not as
   an attribute, which is where a string prop of an overlay also ends up. */
describe('FolderActions and what Hotjar may record', () => {
  it('shows it the name in neither the menu nor the rename', () => {
    show();
    openMenu();
    expect(menu().header).toBe('Work');
    expect(whereHotjarWouldRead('Work')).toEqual([]);

    press(menu(), 'Rename');
    expect(renameDialog().isOpen).toBe(true);
    expect(whereHotjarWouldRead('Work')).toEqual([]);
  });

  it('shows it the name in the deletion neither', () => {
    show();
    openMenu();
    press(menu(), 'Delete');

    expect(deleteDialog().isOpen).toBe(true);
    expect(deleteDialog().message).toContain('“Work”');
    expect(whereHotjarWouldRead('Work')).toEqual([]);
  });
});
