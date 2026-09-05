import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import Account from './Account';
import { renderWithProviders } from '../test/utils';

const { deleteAccount } = vi.hoisted(() => ({ deleteAccount: vi.fn() }));

vi.mock('../services/account.service', () => ({
  default: { deleteAccount: (...args: unknown[]) => deleteAccount(...args) },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'someone@example.com' } }),
}));

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Account />} />
      <Route path="/login" element={<p>Sign in</p>} />
    </Routes>
  );
}

/** Ionic controls report through their own events, not the DOM ones, and
 *  render as custom elements with no implicit ARIA role — so both the input
 *  and the button are reached as elements rather than by role. */
function confirm(word: string) {
  const input = document.querySelector('ion-input')!;
  fireEvent(input, new CustomEvent('ionInput', { detail: { value: word } }));
}

function deleteButton(): HTMLElement & { disabled?: boolean } {
  return document.querySelector('ion-button[color="danger"]')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAccount.mockResolvedValue({ failures: [] });
});

describe('Account', () => {
  it('shows which account is signed in', () => {
    show();
    expect(screen.getByText('someone@example.com')).toBeInTheDocument();
  });

  /* A destructive action reachable by one tap is one a person can take without
     having decided to. */
  it('keeps the delete button disabled until the word is typed exactly', () => {
    show();
    expect(deleteButton().disabled).toBe(true);

    confirm('delete');
    expect(deleteButton().disabled).toBe(true);

    confirm('DELETE');
    expect(deleteButton().disabled).toBe(false);
  });

  it('deletes the account and leaves for the login page', async () => {
    show();
    confirm('DELETE');
    fireEvent.click(deleteButton());

    await waitFor(() => expect(screen.getByText('Sign in')).toBeInTheDocument());
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('stays put and says what went wrong when the request fails', async () => {
    deleteAccount.mockRejectedValue(new Error('Failed to delete the account'));
    show();
    confirm('DELETE');
    fireEvent.click(deleteButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to delete the account')
    );
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  /* Said on the page rather than only in the API docs: an erase that implies it
     reaches storage it has no authority over is the more misleading option. */
  it('says that files in the user own Drive or Dropbox are not touched', () => {
    show();
    expect(screen.getByText(/Google Drive or Dropbox stay there/i)).toBeInTheDocument();
  });
});
