import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import NewFolderDialog from './NewFolderDialog';
import { choose, overlay, press } from '../test/overlays';

function show(isOpen = true) {
  const spies = { onDismiss: vi.fn(), onCreate: vi.fn() };
  const view = render(<NewFolderDialog isOpen={isOpen} {...spies} />);
  return {
    ...spies,
    // New functions, as a page hands over on every render of its own.
    renderAgain: () =>
      view.rerender(
        <NewFolderDialog isOpen={isOpen} onDismiss={() => undefined} onCreate={() => undefined} />
      ),
  };
}

const dialog = () => overlay('ion-alert', 'New Folder');

describe('NewFolderDialog', () => {
  it('is shown when the page says so, and not otherwise', () => {
    show(false);
    expect(dialog().isOpen).toBe(false);
  });

  it('asks for a name, in one field', () => {
    show();

    expect(dialog().isOpen).toBe(true);
    expect(dialog().inputs).toEqual([
      { name: 'folderName', type: 'text', placeholder: 'Folder name' },
    ]);
  });

  it('hands over what was typed, trimmed, and closes', () => {
    const { onCreate, onDismiss } = show();
    press(dialog(), 'Create', { folderName: '  Invoices ' });

    expect(onCreate).toHaveBeenCalledWith('Invoices');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  /* An empty name is a slip to correct. A dialog that vanishes on it reads as
     success, and the folder is not there. */
  it.each([
    ['nothing', { folderName: '' }],
    ['spaces', { folderName: '   ' }],
    ['no field at all', {}],
  ])('stays open on %s, and creates nothing', (_what, typed) => {
    const { onCreate, onDismiss } = show();

    expect(choose(dialog(), 'Create', typed)).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('creates nothing when cancelled', () => {
    const { onCreate, onDismiss } = show();
    press(dialog(), 'Cancel');

    expect(onCreate).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  /* What has been typed lives in the alert's fields, and Ionic rebuilds them
     whenever it is given a different array. With a literal in the JSX, any
     render while the dialog was open wiped the typing: the text stayed on
     screen, Create read an empty value, and no folder was made. */
  it('gives the alert the same fields on every render', () => {
    const { renderAgain } = show();
    const fields = dialog().inputs;

    renderAgain();

    expect(dialog().inputs).toBe(fields);
  });
});
