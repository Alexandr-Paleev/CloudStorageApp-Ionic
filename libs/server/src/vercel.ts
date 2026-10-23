import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The request and the response a Vercel Node function is handed, as
 * `@vercel/node` types them.
 *
 * They were all this repository took from that package, and it brought the
 * runtime of Vercel's own builder along: the edge runtime, a file tracer,
 * esbuild, tsx, ts-morph, a TypeScript of its own, and an undici 5 that not
 * even its newest release has moved on from, every advisory against which
 * showed on the Security tab for code that nothing here runs. Vercel builds
 * the functions with its own copy when it deploys, so the project needs none.
 *
 * The body is `unknown` rather than `any`: what a client sends is read through
 * a type the handler states.
 */
export type VercelRequest = IncomingMessage & {
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  body: unknown;
};

export type VercelResponse = ServerResponse & {
  send: (body: unknown) => VercelResponse;
  json: (jsonBody: unknown) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
};
