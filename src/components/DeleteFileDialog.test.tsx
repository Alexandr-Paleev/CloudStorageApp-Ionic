import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DeleteFileDialog from './DeleteFileDialog';
import { overlay, press } from '../test/overlays';

function show(fileId: string | null) {
  const spies = { onDismiss: vi.fn(), onConfirm: vi.fn() };
  render(<DeleteFileDialog fileId={fileId} {...spies} />);
  return spies;
}

const dialog = () => overlay('ion-alert', 'Delete File');

describe('DeleteFileDialog', () => {
  it('asks nothing while there is no file to ask about', () => {
    show(null);
    expect(dialog().isOpen).toBe(false);
  });

  it('asks, and says the deletion is permanent', () => {
    const { onConfirm } = show('f1');

    expect(dialog().isOpen).toBe(true);
    expect(dialog().message).toContain('permanent');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('hands over the file once the person has said yes', () => {
    const { onConfirm, onDismiss } = show('f1');
    press(dialog(), 'Delete');

    expect(onConfirm).toHaveBeenCalledWith('f1');
    expect(onDismiss).toHaveBeenCalled();
  });

  it('deletes nothing when cancelled', () => {
    const { onConfirm, onDismiss } = show('f1');
    press(dialog(), 'Cancel');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  /* A tap outside the dialog, the back button and Escape all count as the
     button whose role is cancel, so a slip lands on Cancel and never on
     Delete. Delete is marked destructive, which iOS draws in red. */
  it('marks Delete as the destructive choice and Cancel as the way out', () => {
    show('f1');
    const roles = Object.fromEntries(dialog().buttons!.map((button) => [button.text, button.role]));

    expect(roles).toEqual({ Cancel: 'cancel', Delete: 'destructive' });
  });
});
