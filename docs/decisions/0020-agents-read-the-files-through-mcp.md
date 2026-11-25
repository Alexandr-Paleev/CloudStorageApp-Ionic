# 0020 — Agents read the files through MCP, and an agent's token only reads

Proposed · written before the work it decides, like
[0014](0014-the-public-pages-are-a-second-app.md) and
[0019](0019-questions-are-answered-from-pieces-of-the-files.md), and amended
as each piece ships

## Context

A person can search their files by meaning
([0013](0013-search-by-meaning-is-indexed-on-demand.md)) and ask them a
question ([0019](0019-questions-are-answered-from-pieces-of-the-files.md)),
but only on the app's own pages. The assistants people already work in
(Claude, Cursor, an IDE) reach outside data through the Model Context
Protocol: a server offers tools, the assistant's model calls them. A storage
that speaks it can be asked from wherever the person is.

Three things shape how:

- **No function is free.** The Hobby plan allows twelve and all twelve are
  used ([0008](0008-two-actions-one-function.md)).
- **The free path stays free** for any account, on Workers AI, inside the same
  daily budgets ([migration 017](../../migrations/017_bound_ai_spend.sql)).
- **A remote MCP server that needs a sign-in is an OAuth 2.1 resource
  server.** The protocol makes authorization optional, and where a server
  asks for it, the client finds the server's authorization server, registers,
  and sends the person to sign in and consent.

## Decision

**One endpoint, `/mcp`, with three tools that only read, signed in through
Supabase Auth's OAuth 2.1 server; and a token issued to an agent can read the
person's files and nothing more, wherever it is presented.**

- **The tools.**
  - `search_files`: the files nearest a query by meaning, as the dashboard's
    search finds them.
  - `ask_files`: an answer from the pieces of the files, with its numbered
    sources, as `/ask` gives it, whole rather than streamed.
  - `list_files`: names, types, sizes, dates and folders.

  Nothing uploads, renames, deletes or shares. Each call claims a unit of the
  budget its page would claim: `embed` for a search, `ask` for a question.
- **Where it runs.** An action of `api/ai/[action].ts`, which already holds
  the search, the answer, `maxDuration` 60 and `supportsCancellation`;
  `vercel.json` rewrites `/mcp` to it. What the two pages and the tools share
  moves out of the routes into functions both call.
- **The protocol.** The 2026-07-28 revision answers each request on its own,
  with no session and no stream held open, which is what a function can do.
  Clients still speaking a 2025 revision are to be served the same way,
  without a session; M1 checks that the SDK does.
- **The SDK.** `@modelcontextprotocol/server`, the v2 line the protocol's
  authors call stable: it needs Zod 4, which the app already has.
  `@modelcontextprotocol/sdk`, the v1 package, brings Express, Hono, CORS and
  a rate limiter into a function that uses none of them.
- **Sign-in.** Supabase Auth acts as the authorization server, with dynamic
  client registration, so an assistant registers itself. `/mcp` answers a
  request without a token with `401` and a `WWW-Authenticate` header naming
  its protected resource metadata, which says where to sign in. The app hosts
  the consent page Supabase sends the person to (`/oauth/consent`): which
  assistant asks, and that it will read and search their files. A demo account
  is refused by `/mcp` (`isDemoEmail`, as indexing refuses one), since it is
  gone within a day and the connection would outlive it; the consent page
  says so before asking. The page alone cannot refuse it: approving is a call
  the browser makes to Supabase with the person's session, and a demo can
  make it without the page.
- **An agent's token only reads.** Supabase issues an agent the same kind of
  JWT the browser holds, with one claim more, `client_id`. Without more, that
  token could do anything the person can: write and delete `files` and
  `folders` rows, upload and delete their objects in Storage, create a share
  link, erase the account; and read, straight from the database, what the
  person's own pages read besides the files: the profile with its Stripe
  customer and subscription ids, and the share links. So, before the OAuth
  server is turned on:
  - every route but `/mcp` refuses a token that carries `client_id`;
  - a migration adds a restrictive policy to `files`, `folders` and
    `storage.objects` that refuses a write by a token that carries one, as
    [migration 020](../../migrations/020_server_records_hosted_uploads.sql)
    refuses a browser's insert of a hosted upload, and one to `profiles` and
    `shared_links` that refuses it any read, since no tool needs either; the
    policies a person reads and writes by today stay as they are;
  - `/mcp` accepts only a token that does carry one, so a browser's session
    is not an agent's;
  - Supabase Auth's own endpoints take the token too, and nothing of ours
    stands in front of them: with a real agent's token, M2 checks that it
    cannot change the account's email or password, or approve another
    client's request. Until each is shown refused, the OAuth server stays off.
- **A file's text is data.** The tools return it marked as the person's file
  content, never instructions, and each tool's description says so.

## Consequences

- **The token is not bound to this server.** The protocol asks a resource
  server to accept only tokens issued for it, by audience. Supabase issues
  `aud: authenticated` and documents no `resource` parameter, so any token of
  this project is a token here. The rules above are what keeps an agent's
  token to reading; they are checked by tests on each route and on the
  migration, as the other policies are.
- **Scopes cannot narrow it.** Supabase's scopes are OpenID's (`openid`,
  `email`, `profile`, `phone`) and gate none of the data. What an agent may do
  is said on the consent page and enforced by the rules above, not by the
  token.
- **Anyone can register a client.** Dynamic registration is open by design;
  what stands between a client and the files is the person's consent, asked
  every time. The registered clients are listed in Supabase's dashboard.
- **The OAuth server is in beta.** It is free on every plan; each person who
  signs in through it counts as a monthly active user.
- **The model reading a file is not ours any more.** In `/ask` it has no
  tools. An assistant may have mail, a browser, other servers; a file written
  to give it orders reaches a model that could act on them. Reading only, and
  marking the text, narrows that; only the assistant, asking before it acts,
  closes it.
- **The person can take access back.** A grant lasts until revoked; the
  account page lists the assistants given access and revokes one
  (`getUserGrants`, `revokeGrant`). An access token is a JWT that lasts its
  hour; `/mcp` asks Supabase about each one (`getUser`) rather than check its
  signature alone, and M2 checks that a revoked assistant's token is refused
  at once, not when it expires.
- **`api/ai` gets heavier.** The SDK joins the function every AI route loads,
  and its cold start is measured before and after.

## Alternatives

- **Personal access tokens,** made on the account page and pasted into an
  assistant's settings, stored hashed like share tokens
  ([0003](0003-share-tokens-are-stored-hashed.md)). Simpler, but an
  assistant on the web is connected by signing in, not by pasting, and a
  pasted token lives in a config file with no consent page in front of it.
- **An authorization server of our own.** The SDK's is frozen in a legacy
  package, and issuing tokens is the part of this most costly to get wrong.
- **A local server over stdio,** run on the person's machine. It needs their
  credentials in a config file, and a web assistant cannot reach it.
- **A function of its own.** There is no thirteenth.

## Steps

- **M1.** `/mcp` and the three tools. Until M2 it takes the token the app
  already uses, for testing with the MCP Inspector and Claude Code; nothing
  points an assistant at it yet.
- **M2.** The token rules and their migration, the protected resource
  metadata, the consent page, and the assistants on the account page; then
  the OAuth server and dynamic registration in Supabase.
- **M3.** The tools measured in `evals/`: whether a model picks the right one
  and passes it the right arguments, recorded and graded by rules, as the
  answers are.
- **M4.** How to connect, in the README, and the release.
