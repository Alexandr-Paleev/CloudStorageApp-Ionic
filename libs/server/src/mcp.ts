import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VercelRequest, VercelResponse } from './vercel';
import {
  FILE_TEXT_IS_DATA,
  LIST_PAGE,
  MAX_LIST_PAGE,
  MAX_QUERY_CHARS,
  ToolRefusal,
  type FileTools,
} from './mcp-tools';
import { MAX_QUESTION_CHARS } from './answer';

/**
 * The person's files, as an assistant reaches them through the Model Context
 * Protocol (ADR 0020): three tools that only read.
 *
 * What each tool does is the route's (`api/ai/[action].ts`), which runs the
 * same search, pieces and answer the pages do; this module says what the
 * tools are to a model, keeps a file's text marked as data, and carries one
 * HTTP request between a Vercel function and the SDK. The route imports it
 * only for `/mcp`; what it shares with the route is in `mcp-tools.ts`.
 */

const DATA_NOTE = ` ${FILE_TEXT_IS_DATA.replace('this result', 'results')}`;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/**
 * JSON, so a file's text is a string inside it: a file cannot close the
 * string the way it could close a fence of markdown, and nothing in it reads
 * as this server speaking.
 */
function result(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export type ToolErrorReporter = (error: unknown, tool: string) => void | Promise<void>;

async function run(
  tool: string,
  onError: ToolErrorReporter,
  work: () => Promise<Record<string, unknown>>
) {
  try {
    return result(await work());
  } catch (error) {
    if (error instanceof ToolRefusal) return failure(error.message);
    await onError(error, tool);
    return failure(`${tool} could not be finished. Try again.`);
  }
}

/** The server one request is answered by, over these tools. */
export function mcpServer(tools: FileTools, onError: ToolErrorReporter): McpServer {
  const server = new McpServer(
    { name: 'cloud-storage', version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' },
    {
      instructions:
        "The person's own files in Cloud Storage, read only: search them by meaning, " +
        'ask a question of what they say, or list them. Nothing here uploads, changes, ' +
        `deletes or shares a file.${DATA_NOTE}`,
    }
  );

  server.registerTool(
    'search_files',
    {
      title: 'Search files by meaning',
      description:
        "Finds the person's files whose content is nearest in meaning to the query, " +
        'nearest first, each with a sentence describing it. Use it to find a file ' +
        'when its name is not known. Only files indexed for search by meaning are ' +
        `found; list_files lists every file by name.${DATA_NOTE}`,
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(MAX_QUERY_CHARS)
          .describe('What the file is about, in any language: "the lease for the flat"'),
      }),
      annotations: { ...READ_ONLY, idempotentHint: true },
    },
    ({ query }) =>
      run('search_files', onError, async () => {
        const text = query.trim();
        if (!text) throw new ToolRefusal('The query is empty.');
        const files = await tools.search(text);
        return { note: FILE_TEXT_IS_DATA, files };
      })
  );

  server.registerTool(
    'ask_files',
    {
      title: 'Ask a question of the files',
      description:
        "Answers a question from what the person's files say: the pieces of their text " +
        'nearest to the question are read by a model, which answers from them alone ' +
        'and cites them as [n]. Each source is that piece, to check the answer ' +
        'against. When the files do not hold the answer, it says so. It takes several ' +
        `seconds.${DATA_NOTE}`,
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe('A question about what the files say: "when does my lease end?"'),
      }),
      annotations: READ_ONLY,
    },
    ({ question }) =>
      run('ask_files', onError, async () => {
        const text = question.trim();
        if (!text) throw new ToolRefusal('The question is empty.');
        // Characters as the page counts them, not UTF-16 units (answer.ts).
        if ([...text].length > MAX_QUESTION_CHARS) {
          throw new ToolRefusal(`The question is longer than ${MAX_QUESTION_CHARS} characters.`);
        }
        const answered = await tools.ask(text);
        if (answered.answer === null) {
          return {
            answer: null,
            message:
              'None of the files is indexed for questions yet. The person indexes them ' +
              'from the dashboard, with "Index them".',
          };
        }
        return { note: FILE_TEXT_IS_DATA, ...answered };
      })
  );

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description:
        "Lists the person's files, newest first: name, type, size in bytes, when it " +
        'was added and its folder, with every folder\'s path. Give "folder" to list ' +
        `only the files directly in that folder; "/" lists those at the top.${DATA_NOTE}`,
      inputSchema: z.object({
        folder: z
          .string()
          .optional()
          .describe('A folder\'s path as the listing gives it, "Taxes/2026"'),
        limit: z.number().int().min(1).max(MAX_LIST_PAGE).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { ...READ_ONLY, idempotentHint: true },
    },
    ({ folder, limit, offset }) =>
      run('list_files', onError, async () => {
        const listing = await tools.list({
          folder,
          limit: limit ?? LIST_PAGE,
          offset: offset ?? 0,
        });
        // Names are the person's writing too, and a name can be written to be obeyed.
        return { note: FILE_TEXT_IS_DATA, ...listing };
      })
  );

  return server;
}

/** The request as the SDK reads it: a web `Request`, with the body Vercel has already parsed. */
function webRequest(req: VercelRequest, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  /* The body travels as `parsedBody`, not as bytes: Vercel has read the
     stream already, and a length that no longer matches a body is a lie. */
  headers.delete('content-length');
  return new Request(`https://${req.headers.host ?? 'localhost'}${req.url ?? '/mcp'}`, {
    method: req.method,
    headers,
    signal,
  });
}

/**
 * Answers one MCP request with the server `build` makes, and writes the SDK's
 * response back through Vercel's. Both revisions are served the same way, one
 * request at a time with nothing kept between them: 2026-07-28, which has no
 * session, and the 2025 ones without the session they allow (the SDK's
 * stateless fallback), which is all a function can keep.
 *
 * `signal` ends the exchange, a model's answer included, when the caller
 * goes away.
 */
export async function serveMcp(
  req: VercelRequest,
  res: VercelResponse,
  build: () => McpServer,
  signal: AbortSignal
): Promise<void> {
  const handler = createMcpHandler(() => build());
  let response: Response;
  try {
    response = await handler.fetch(webRequest(req, signal), { parsedBody: req.body });
  } catch (error) {
    // Nobody is there to answer, and a caller leaving is not a failure.
    if (!signal.aborted) throw error;
    res.end();
    return;
  }

  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  }
  res.end();
}
