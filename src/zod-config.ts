import { z } from 'zod';

/* No compiling. zod 4 builds a faster parser for an object schema with
   `new Function`, and first asks whether it may by calling `Function('')`.
   The content policy refuses both (vercel.json has no 'unsafe-eval'), so every
   page load drew refusals that were not the app's to fix, and
   observability/csp-violations.ts would report them as if they were.

   zod asks once, at the first parse, and keeps the answer, so this has to run
   before env.ts parses as it is imported, and env.ts imports it. Being the
   first import of main.tsx was not enough: the build put env.ts in a chunk
   that runs before main.tsx's own code, and the probe went on. */
z.config({ jitless: true });
