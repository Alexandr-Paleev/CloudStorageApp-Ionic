import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ReconnectDriveDialog from './ReconnectDriveDialog';
import { overlay, press } from '../test/overlays';

function show(blocked: 'file' | 'folder' | null) {
  const spies = { onDismiss: vi.fn(), onConnect: vi.fn(), onRemoveFromList: vi.fn() };
  render(<ReconnectDriveDialog blocked={blocked} {...spies} />);
  return spies;
}

const dialog = () => overlay('ion-alert', 'Google Drive is not connected');

describe('ReconnectDriveDialog', () => {
  it('asks nothing while no deletion is waiting', () => {
    show(null);
    expect(dialog().isOpen).toBe(false);
  });

  it('says why a file was not deleted, and both ways out', () => {
    show('file');

    expect(dialog().isOpen).toBe(true);
    expect(dialog().message).toBe(
      'This file is in your Google Drive. Connect Drive to delete it there, or remove it from this list and keep it in your Drive.'
    );
  });

  it('speaks of the files in a folder when a folder stopped at one', () => {
    show('folder');
    expect(dialog().message).toMatch(/^Some files in this folder are in your Google Drive\./);
  });

  it('connects Drive from the press itself', () => {
    const { onConnect, onRemoveFromList } = show('file');
    press(dialog(), 'Connect Drive');

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onRemoveFromList).not.toHaveBeenCalled();
  });

  it('takes it off the list when asked to', () => {
    const { onConnect, onRemoveFromList } = show('file');
    press(dialog(), 'Remove from list');

    expect(onRemoveFromList).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();
  });

  /* A tap outside, the back button and Escape all count as Cancel. Neither
     answer is marked destructive: the person already said yes to deleting,
     and what this asks is only where the Drive files go. */
  it('does neither when cancelled, and goes', () => {
    const { onConnect, onRemoveFromList, onDismiss } = show('file');
    press(dialog(), 'Cancel');

    expect(onConnect).not.toHaveBeenCalled();
    expect(onRemoveFromList).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
    const roles = Object.fromEntries(dialog().buttons!.map((button) => [button.text, button.role]));
    expect(roles).toEqual({
      Cancel: 'cancel',
      'Remove from list': undefined,
      'Connect Drive': undefined,
    });
  });
});
