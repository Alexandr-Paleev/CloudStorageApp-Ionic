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
  (`listGrants`, `revokeGrant`). An access token is a JWT that lasts its
  hour; `/mcp` asks the database whether the session behind each one still
  exists rather than check its signature alone (see the amendment M2c and
  M2d), so a revoked assistant's token is refused at once, not when it
  expires.
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

## Amendments

- **M1 (2026-11-25).** `/mcp` answers, rewritten by `vercel.json` to the
  `mcp` action of `api/ai/[action].ts`, with `@modelcontextprotocol/server`
  2.4.0. The tools are in `libs/server/src/mcp.ts`, what they do in the
  route, over what the pages use: `search_files` claims `embed` and reads
  `match_files` as the caller with the dashboard's 15 results and floor;
  `ask_files` claims `ask`, reads the pieces through the same
  `nearestPieces` as `/ask`, and returns the answer whole with its sources;
  `list_files` claims nothing, and gives each folder as a path,
  "Taxes/2026". Each tool is marked read-only, not destructive and
  closed-world. Each result is JSON with a note that the files' words in it
  are data, the names a listing gives included, since a person writes those
  too; a file cannot close the string that holds it. A spent budget, a
  per-minute limit or an unknown folder is said to the model as the tool's
  error, and any other failure is reported and said only as a failure. A
  demo account is refused with 403 before any tool. The SDK
  serves 2025 clients without a session, as this ADR asked of it: a test
  sends `initialize`, then `tools/list` and `tools/call`, each on its own
  and with no `Mcp-Session-Id`, and does the same for 2026-07-28. The SDK
  loads 11 files, some 940 kB, in about 30 ms more than the Zod the function
  already loads (55 ms and 26 ms, on a laptop); it is imported only for
  `/mcp`, so the pages' requests to the function load none of it at a cold
  start. The token is still the app's own, as the step says.
- **M2, the token rules (2026-11-25).** `authenticate` in
  `libs/server/src/auth.ts`, through which every route checks a token,
  takes a `caller`: `'person'` everywhere, which refuses a token with
  `client_id`, and `'agent'` at `/mcp`, which takes only one; the claim is
  read from the payload after `getUser` has accepted the token. Any value
  of the claim but none is an assistant's, as the database reads it.
  Migration 024 adds the restrictive policies: no insert, update or delete
  on `files`, `folders` and `storage.objects`, nothing at all on `profiles`
  and `shared_links`, for a token whose `client_id` is not null. It was
  run, twice, against Postgres with the tables' permissive policies, and
  probed as an assistant and as the person. `/mcp` answers 401 with
  `WWW-Authenticate: Bearer resource_metadata=…, scope="email"`; the
  metadata, an action `resource` of the same function, names
  `/mcp` at the host asked and `<SUPABASE_URL>/auth/v1` as its
  authorization server, and any page may read it. `email` is the scope
  asked for: no tool needs an ID token, which `openid` asks for and which
  Supabase signs only with an asymmetric key (production signs with ES256,
  so a fork on the shared secret is the one it would fail). Every other
  `/.well-known/` path answers 404 rather than the app's page, so a client
  looking for an authorization server here, as 2025-03-26 clients did, is
  told there is none. `/mcp` is limited per account, 120 a minute, and
  per address only at ten times the pages' limit: an assistant on the web
  calls from a few addresses all its users share. From this deployment on,
  `/mcp` takes no token at all until the OAuth server issues one.
- **M2, the consent page and the assistants (2026-11-25).** `/oauth/consent`
  (`src/pages/OAuthConsent.tsx`) reads the request with
  `getAuthorizationDetails` and answers it with `approveAuthorization` or
  `denyAuthorization`, keeping supabase-js from leaving the page so that the
  address it goes to is checked first: any scheme an assistant may come
  back to (`https:`, `http://localhost`, an app's own), none that runs in
  the page (`javascript:`, `data:`). The id is checked for its shape before
  any call, since supabase-js puts it into the request's path as it is. The
  page names the assistant as it registered and, as what a registration
  cannot dress up, the host it goes back to; it says that a link someone
  sent can ask for the files in their assistant's name, the consent
  phishing open registration allows. Signed out, the request waits in
  sessionStorage (`src/utils/pending-consent.ts`) and every way of signing
  in leads back to it, Google's return address included; signed in, it
  moves to the page's address and out of storage, so that a request walked
  away from, or expired, does not lead every later sign-in of the tab back
  here. Its address
  carries the id in its query, which keeps the collectors from starting and
  Sentry from keeping it ([0015](0015-collectors-are-told-paths.md)).
  A demo account sees why it cannot connect one and may only deny. The
  account page lists the grants (`listGrants`) and revokes one; it shows
  the section only when Supabase answers with a list, so nothing appears
  until the OAuth server is on. Its endpoints answer 404 until then, read as
  no list rather than as an error, which every query reports to Google
  Analytics; M2c checks the 404 on a local Supabase with the server off.
- **M2c and M2d, Supabase Auth's own endpoints (2026-11-26).** Checked on a
  local Supabase (CLI 2.111.0, Auth v2.194.0) with the project's 25
  migrations and a real assistant: registered, sent to `/authorize`, let in
  through the same calls the consent page makes, its code exchanged. The
  flow, the deny, the 404 with the server off (`feature_disabled`, which
  supabase-js keeps as `status: 404`), migration 024 and the revoke all did
  what the steps above say. Auth itself did not: the assistant's token was
  the person's whole session there. With it, `PUT /user` set the account's
  password (200; signing in with the new one worked, and the person's own
  sessions ended), wrote `user_metadata`, and started an email change,
  stopped only by the confirmation the old address must give; it read
  another assistant's request, which binds it to the person, and approved
  it; it could sign the person out everywhere. Supabase's documentation
  says nothing of these endpoints; it offers RLS on `client_id` and the
  Custom Access Token hook. A different `aud` from the hook changes nothing:
  Auth, PostgREST and Storage take the token alike. What Auth does read is
  `session_id`: it looks the session up for every endpoint that needs one
  and refuses with `403 session_not_found` when there is none, unless the id
  is empty or the nil uuid. PostgREST and Storage do not read it.
  [Migration 025](../../migrations/025_assistant_tokens_do_not_reach_auth.sql)
  therefore adds the hook `hide_assistant_session`, which moves an
  assistant's `session_id` to `mcp_session_id` and puts a fresh random uuid
  in its place; `assistant_session_alive()`, which finds that session for
  the assistant and the account named in the token; and a restrictive
  SELECT policy on `files`, `folders`, `file_chunks`, `file_embeddings` and
  the bucket's objects that asks it of any token with `client_id`. With the
  hook on, ten endpoints of Auth answered the assistant 403, the password,
  the email, the metadata, MFA, `/logout`, the grants and the consent among
  them; the database read for it as before, 024 still refused its writes; a
  refresh kept the session hidden; the person's sign-in did not change.
  `getUser` now refuses an assistant too, so `authenticate` checks one by
  calling `assistant_session_alive` as the caller: PostgREST verifies the
  signature and the expiry (a token it will not take, `PGRST30x`, is a 401;
  any other failure is ours, a 500), the function finds the session, and the
  id and the email are the token's own claims. Revoking deletes the
  session, so `/mcp` refuses the token at once, and so do PostgREST and
  Storage, which until now would have read for it to the end of its hour.
  A token issued while the hook is off has no `mcp_session_id` and reads
  nothing, so turning the hook off fails closed everywhere but at Auth.
  The real `authenticate`, run against that Supabase, took the assistant,
  refused it on a person's route, refused a person at `/mcp`, refused a
  token with its subject altered, and refused the assistant the moment it
  was revoked. Production was read before writing 025: `auth.sessions` has
  `oauth_client_id`, and no hook was set up. The order there: 025, then the
  hook (Authentication → Hooks → Custom Access Token,
  `public.hide_assistant_session`), a sign-in of a person to see it changed
  nothing, then the OAuth server with dynamic registration and
  `/oauth/consent`. Two things to look at once it is on: the discovery
  document at the address RFC 8414 builds for an issuer with a path,
  `/.well-known/oauth-authorization-server/auth/v1`, answered 404 locally,
  and clients reach it at `/auth/v1/.well-known/openid-configuration`
  instead, as the MCP specification lets them; and whether MFA by TOTP is
  enabled, which the hook covers too (`/factors` needs a session).
  Found in review: a sign-out with supabase-js's default scope, `global`,
  ends every session of the account, the assistants' with them (checked:
  `assistant_session_alive` false, the refresh token refused; `others` the
  same, `local` neither). The app's Log out and the consent page's "Use
  another account" used that default, so every sign-out of the app would
  have disconnected every assistant. `authService.logout` now signs out of
  this browser alone. A new password still ends every session, the
  assistants' included (checked), which is what a new password is for; the
  account page's Revoke ends one assistant's. The assistant's refresh token
  is refused at the person's `/token` endpoint, and at `/oauth/token` under
  another client's id.
- **M2 in production (2026-11-27).** Migration 025 was run and checked
  (both functions, the five policies, the hook on a made-up event; inside a
  transaction rolled back, a person read their 15 files and 3 folders and
  an assistant with no live session none). Then the hook was set, a person
  signed in by password, by Google and as the demo as before, and the OAuth
  server was turned on with dynamic registration and `/oauth/consent`. The
  discovery document answers at all three addresses, the one RFC 8414 builds
  for an issuer with a path included, which only the local Supabase did not.
  An assistant registered, sent the person to the consent page (a demo
  account could only deny), and was let in. With its token, Auth answered
  `403 session_not_found` to `GET` and `PUT /user`, `/factors`, the grants,
  another request and `/logout`; `/mcp` listed its three tools and PostgREST
  read the 15 files; a refresh kept the session hidden; it read on after the
  person signed out of the app and in again. After Revoke on the account
  page, the database held no assistant's session and no live refresh token
  of one, and a session is what `/mcp`, PostgREST and Storage ask for.
- **M3 (2026-11-27).** `evals/` measures which tool a model calls, from the
  server's instructions and `tools/list` word for word
  (`libs/server/src/mcp.eval-contract.json`, which `mcp.test.ts` holds the
  server to), for 60 requests in English, Spanish and Russian, 9 of them
  ones no tool is for. Graded by rules from the first call: the tool, the
  arguments against the schema, and the query, question or folder against
  what was asked. On Workers AI, `mistral-small-3.1-24b-instruct` called the
  right tool 59 times of 60 and never mixed the three up; its miss was the
  weather sent to `ask_files`. `llama-3.3-70b-instruct-fp8-fast` called the
  right one 49 times: a tool for each of the 9 requests none fits (8 of them
  `ask_files`, the request turned into a question), "where is…" sent to
  `ask_files` twice, two Russian queries written in Latin letters, and one
  `limit` given as a string. Every tool only reads, so a wrong choice costs
  a question of the day's allowance, not a file. The descriptions are not
  changed here: a change to them is measured before it ships, and Claude,
  which the person's assistant most likely is, costs per run and is not
  measured. Details and the tables in `evals/README.md`.
