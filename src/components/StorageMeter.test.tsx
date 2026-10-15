import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StorageMeter from './StorageMeter';

const MB = 1024 * 1024;

function show(usedBytes: number, storageLimit = 500 * MB, tier?: string) {
  render(<StorageMeter usedBytes={usedBytes} storageLimit={storageLimit} tier={tier} />);
}

/** The sentence is assembled from several JSX expressions, so it is several
 *  text nodes and getByText cannot see it whole. */
const stats = () => document.querySelector('.storage-stats') as HTMLElement;
const figure = () => document.querySelector('.storage-percentage') as HTMLElement;
const bar = () => document.querySelector('.storage-bar-fill') as HTMLElement;
/** Ionic's props are properties of the element, not attributes. */
const colourOf = (element: HTMLElement) => (element as unknown as { color?: string }).color;

describe('StorageMeter', () => {
  it('says what is used against the limit it is given', () => {
    show(100 * MB);

    expect(stats()).toHaveTextContent('100.00 MB of 500.00 MB used');
    expect(figure()).toHaveTextContent('20.0%');
    expect(bar()).toHaveStyle({ width: '20.0%' });
  });

  it('keeps quiet colours while there is room', () => {
    show(100 * MB);

    expect(colourOf(figure())).toBe('medium');
    expect(colourOf(stats())).toBe('medium');
    expect(stats()).not.toHaveTextContent(/over the limit/);
  });

  /* Cancelling Pro drops the limit without deleting anything, so an account
     can sit well past its plan. The bar cannot draw past full; the figure and
     the sentence have to say how far past, because that is also why uploads
     have stopped working. */
  describe('past the limit', () => {
    it('stops the bar at full and lets the figure run on', () => {
      show(600 * MB);

      expect(bar()).toHaveStyle({ width: '100.0%' });
      expect(figure()).toHaveTextContent('120.0%');
    });

    it('says by how much, and that uploads are blocked', () => {
      show(600 * MB);

      expect(stats()).toHaveTextContent(
        '600.00 MB of 500.00 MB used — 100.00 MB over the limit, uploads are blocked until you free up space'
      );
    });

    it('says it in red', () => {
      show(600 * MB);

      expect(colourOf(figure())).toBe('danger');
      expect(colourOf(stats())).toBe('danger');
    });
  });

  it('marks a Pro account as one', () => {
    show(100 * MB, 5 * 1024 * MB, 'pro');
    expect(screen.getByText('Pro')).toHaveClass('tier-badge--pro');
  });

  it('marks no other account', () => {
    show(100 * MB, 500 * MB, 'free');
    expect(screen.queryByText('Pro')).not.toBeInTheDocument();
  });
});
