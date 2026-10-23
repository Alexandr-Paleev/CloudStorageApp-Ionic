import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import './zod-config';

describe('zod in the app', () => {
  it('compiles nothing, so the content policy has nothing to refuse', () => {
    const compile = vi.spyOn(globalThis, 'Function');
    try {
      expect(z.config().jitless).toBe(true);
      expect(z.object({ a: z.string(), b: z.number() }).parse({ a: 'x', b: 1 })).toEqual({
        a: 'x',
        b: 1,
      });
      expect(compile).not.toHaveBeenCalled();
    } finally {
      compile.mockRestore();
    }
  });
});
