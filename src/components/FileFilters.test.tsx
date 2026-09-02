import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FileFilters, { type FileFiltersValue } from './FileFilters';
import { DEFAULT_DIRECTION, DEFAULT_SORT } from '../utils/file-query';

const BASE: FileFiltersValue = {
  search: '',
  sort: DEFAULT_SORT,
  direction: DEFAULT_DIRECTION,
  group: 'all',
};

function show(value: Partial<FileFiltersValue> = {}, resultCount?: number) {
  const onChange = vi.fn();
  render(
    <FileFilters value={{ ...BASE, ...value }} onChange={onChange} resultCount={resultCount} />
  );
  return { onChange };
}

/** Ionic controls report through their own events, not through the DOM ones. */
const ionEvent = (element: Element, name: string, value: unknown) =>
  fireEvent(element, new CustomEvent(name, { detail: { value } }));

describe('FileFilters', () => {
  it('offers every type group', () => {
    show();
    for (const label of ['All', 'Images', 'Documents', 'Other']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('reports what was typed', () => {
    const { onChange } = show();
    ionEvent(screen.getByTestId('file-search'), 'ionInput', 'invoice');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'invoice' }));
  });

  it('keeps the rest of the filters when one changes', () => {
    // Each control sends the whole value back, so a careless spread here would
    // reset the sort every time somebody typed a letter.
    const { onChange } = show({ group: 'images', sort: 'size', direction: 'asc' });
    ionEvent(screen.getByTestId('file-search'), 'ionInput', 'holiday');

    expect(onChange).toHaveBeenCalledWith({
      search: 'holiday',
      group: 'images',
      sort: 'size',
      direction: 'asc',
    });
  });

  it('treats a cleared searchbar as an empty search, not as undefined', () => {
    const { onChange } = show({ search: 'invoice' });
    ionEvent(screen.getByTestId('file-search'), 'ionInput', null);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
  });

  it('splits the ordering back into a field and a direction', () => {
    const { onChange } = show();
    ionEvent(document.querySelector('ion-select')!, 'ionChange', 'name:asc');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'name', direction: 'asc' })
    );
  });

  it('says nothing about scope until there is a search', () => {
    show();
    expect(screen.queryByText(/every folder/i)).not.toBeInTheDocument();
  });

  it('says that a search leaves the current folder', () => {
    // The scope changes under the user's feet, so it is said out loud.
    show({ search: 'invoice' }, 3);
    expect(screen.getByText(/Searching every folder/)).toBeInTheDocument();
  });

  it('reports an empty result as empty everywhere, not just here', () => {
    show({ search: 'invoice' }, 0);
    expect(
      screen.getByText(/No files match .*invoice.* anywhere in your storage/)
    ).toBeInTheDocument();
  });

  it('does not claim a count it was not given', () => {
    show({ search: 'invoice' });
    expect(screen.getByText('Searching every folder')).toBeInTheDocument();
  });
});
