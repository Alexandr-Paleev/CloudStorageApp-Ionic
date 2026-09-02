import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FolderBreadcrumbs from './FolderBreadcrumbs';
import type { Folder } from '../services/storage.service';

const folder = (id: string, name: string, parent: string | null = null): Folder =>
  ({ id, name, parent_id: parent, user_id: 'user-1' }) as Folder;

function show(path: Folder[]) {
  const onNavigate = vi.fn();
  render(<FolderBreadcrumbs path={path} onNavigate={onNavigate} />);
  return { onNavigate };
}

describe('FolderBreadcrumbs', () => {
  it('renders nothing at the root', () => {
    show([]);
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });

  it('shows the whole chain, root first', () => {
    show([folder('a', 'Work'), folder('b', 'Invoices', 'a')]);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
  });

  it('goes to the root from Home', () => {
    const { onNavigate } = show([folder('a', 'Work')]);
    fireEvent.click(screen.getByText('Home'));

    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('goes to an ancestor by name', () => {
    const { onNavigate } = show([folder('a', 'Work'), folder('b', 'Invoices', 'a')]);
    fireEvent.click(screen.getByText('Work'));

    expect(onNavigate).toHaveBeenCalledWith('a');
  });

  it('does not offer the folder already open as a link', () => {
    // A click that does nothing is worse than no click target.
    const { onNavigate } = show([folder('a', 'Work'), folder('b', 'Invoices', 'a')]);
    fireEvent.click(screen.getByText('Invoices'));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('marks the open folder for assistive technology', () => {
    show([folder('a', 'Work'), folder('b', 'Invoices', 'a')]);
    expect(screen.getByText('Invoices')).toHaveAttribute('aria-current', 'page');
  });

  it('names the whole thing, so it is not read as a list of stray links', () => {
    show([folder('a', 'Work')]);
    expect(screen.getByLabelText('Folder path')).toBeInTheDocument();
  });
});
