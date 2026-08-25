import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

/**
 * Serves the handlers in api/ from the Vite dev server.
 *
 * Without this, `npm run dev` only serves the frontend and every /api/* call
 * 404s, so the serverless functions could only be exercised through `vercel
 * dev` (which needs a logged-in CLI) or by deploying. The middleware mimics
 * just enough of the Vercel Node runtime for these handlers: the response
 * helpers they call, a parsed req.body, and — importantly for the Stripe
 * webhook — a request that can still be read as a raw stream.
 *
 * Dev only: `apply: 'serve'` keeps it out of the production build entirely.
 */
export function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',

    configureServer(server) {
      // Handlers read process.env, but Vite only exposes VITE_ vars to the
      // client. An empty prefix loads every key from .env.
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));

      // Registered here rather than in a returned callback so it runs before
      // Vite's SPA fallback, which would otherwise answer /api/* with index.html.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();

        const [pathname, search = ''] = url.split('?');
        const file = resolve(process.cwd(), `${pathname.slice(1)}.ts`);
        if (!existsSync(file)) {
          return sendJson(res, 404, { message: `No handler at ${pathname}` });
        }

        try {
          const mod = await server.ssrLoadModule(file);
          const handler = mod.default;
          if (typeof handler !== 'function') {
            return sendJson(res, 500, { message: `${pathname} has no default export` });
          }
          await handler(await asVercelRequest(req, search), asVercelResponse(res));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Handler failed';
          server.config.logger.error(`[dev-api] ${pathname}: ${message}`);
          if (!res.writableEnded) sendJson(res, 500, { message });
        }
      });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Adds the request helpers the handlers expect. The raw body is replayed onto
 * the request afterwards, the same way @vercel/node does, so a handler that
 * reads the stream itself — the webhook, verifying its signature — still works
 * even though req.body has already been parsed.
 */
async function asVercelRequest(req: IncomingMessage, search: string) {
  const raw = await readBody(req);
  const contentType = req.headers['content-type'] || '';

  let body: unknown;
  if (raw.length === 0) body = undefined;
  else if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = undefined;
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  } else {
    body = raw.toString('utf8');
  }

  return Object.assign(req, {
    body,
    query: Object.fromEntries(new URLSearchParams(search)),
    cookies: parseCookies(req.headers.cookie),
    [Symbol.asyncIterator]: async function* () {
      yield raw;
    },
  });
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [name, ...rest] = part.trim().split('=');
      return [name, decodeURIComponent(rest.join('='))];
    })
  );
}

function asVercelResponse(res: ServerResponse) {
  return Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return this;
    },
    send(body: unknown) {
      if (typeof body === 'object' && body !== null) return this.json(body);
      res.end(String(body));
      return this;
    },
    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
      const location = typeof statusOrUrl === 'number' ? maybeUrl! : statusOrUrl;
      res.statusCode = status;
      res.setHeader('Location', location);
      res.end();
      return this;
    },
  });
}
