# 0013 — Search by meaning is indexed on demand, by a swappable model

Accepted · migration [`011`](../../migrations/011_add_file_embeddings.sql) · [`api/ai/[action].ts`](../../api/ai/%5Baction%5D.ts)

## Context

The dashboard searches `files.name` with `ilike`. Two thirds of the rows in
production are photographs carrying the name a camera gave them, so for those
the feature answers one question — do you remember the filename — and the
answer is no.

Searching by what a file *is* needs three things this project did not have: a
description of each file, a vector of that description, and somewhere to
compare vectors. It also needs a decision about who pays, because every one of
those descriptions is a request to a model provider and this deployment hands
a working account to anyone who opens the site.

## Decision

**Descriptions are written on request, never on upload.** Uploading is free;
indexing is a button that says how many files are not indexed yet. A visitor
who opens the demo therefore costs nothing, and the same is true of the demo
accounts `/api/demo/session` creates — `/api/ai/index` refuses them by email
prefix and says so in the response.

**The models are chosen by which keys exist.** Claude and Voyage when
`ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are set; Cloudflare Workers AI, which
has a free daily allowance, when only `CLOUDFLARE_AI_TOKEN` is; and a 501 with
a message the interface repeats when neither is. A deployment that costs its
author money whenever a stranger visits is a deployment that gets switched
off, and this one stays on.

**The vectors carry the name of the model that made them**, and `match_files`
filters by it. Two models place the same sentence in different spaces, so a
distance measured across them is not a worse number — it is a meaningless one
that looks exactly like a good answer. Switching provider hides the old rows
until they are re-indexed rather than quietly ranking nonsense first.

**The search runs in the browser, under the user's own session.** Only the two
steps that need a secret — describing a file, embedding a query — go through
`/api/ai/*`. The ranking itself is `supabase.rpc('match_files')` from the page,
exactly as the ordinary listing is a `select` from the page, so what a caller
can see is decided by RLS in the database and not by a route remembering to
forward a token.

## Consequences

- A file that has never been indexed cannot be found this way, and the
  interface has to say so — an empty result otherwise reads as a broken
  feature rather than an empty index.
- The free backend is visibly worse at describing pictures, and has no
  structured output, so its answers are parsed leniently rather than trusted.
  It also cannot read a PDF: nothing on that path renders a page, so those
  files are skipped with a reason instead of being described from their name.
- One more serverless function, which is the twelfth and last the Hobby plan
  allows ([0008](0008-two-actions-one-function.md)). The next route to be
  added has to share a file with something.
- `file_embeddings` is written by the service-role key alone; the browser has
  `SELECT` and no other grant, which is [0002](0002-billing-is-server-write-only.md)
  applied to a table nobody has been tempted by yet.
- The indexer verifies the path on a row before reading it, and does not obey
  the stored Cloudinary URL without checking it. `files` rows are written by
  the browser under a policy that says which *rows* an account may write and
  nothing about what goes in them, and this service holds the service-role key
  — so a row pointing at another account's object, or at an address on the
  internal network, would otherwise have been read and described back to
  whoever asked. The prefixes it checks are the ones the upload routes create,
  and they match every row in production.

- Quality is not measured yet, and until it is, "the free model is good
  enough" is a claim rather than a finding. Every row records the model that
  wrote it and the model that embedded it, which is what makes the eval
  possible to write later and attributable when it moves — it is the next
  piece of work on this feature, not a nice-to-have.
