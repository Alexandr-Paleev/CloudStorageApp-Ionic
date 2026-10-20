import { describe, expect, it, vi } from 'vitest';
import { afterFirstInteraction } from './first-interaction';

describe('afterFirstInteraction', () => {
  it('runs at the first thing the visitor does, and only then', () => {
    const task = vi.fn();
    afterFirstInteraction(task);
    expect(task).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('pointerdown'));

    expect(task).toHaveBeenCalledTimes(1);
  });

  /* Listened for on the way down, so a tap on anything in the page counts,
     including what stops it from bubbling. */
  it('hears a tap on anything in the page', () => {
    const task = vi.fn();
    afterFirstInteraction(task);

    document.body.dispatchEvent(new Event('touchstart'));

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('can be called off', () => {
    const task = vi.fn();
    const stop = afterFirstInteraction(task);

    stop();
    window.dispatchEvent(new Event('wheel'));

    expect(task).not.toHaveBeenCalled();
  });
});
