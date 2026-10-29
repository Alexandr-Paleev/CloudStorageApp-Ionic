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

**A deployment without keys does not show the feature.**
`VITE_SMART_SEARCH_ENABLED` decides whether the mode appears at all, the same
way `billingIsOffered()` decides whether a buy button does. The route refuses
on its own regardless — but its refusal names environment variables, which is
a sentence for whoever deploys this and not for whoever is looking at it. A
switch that cannot work reads as a broken app, and every fresh clone of this
repository is such a deployment.

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

## Update — 2026-10-29

**Every read of these rows asks by model, not only the search.** Hiding the
old rows after a change of backend was half of the rule above. The count of
files not indexed yet read `file_embeddings` without the model, so it called
every file the old model had indexed done: the dashboard never offered those
files again, and a search by meaning found none of them, for good and without
a word about why. The count now asks about the model the search on screen was
made with (`src/services/ai.service.ts`), and the re-index this record leans
on is that button. There is no backfill script, whatever three comments said.

**What a distance across two models is, measured.** Locally, on open weights:
ten file descriptions written the way `embeddingInput` writes them, embedded
by `bge-large-en-v1.5`, this deployment's free model, and fifteen queries,
seven of which share no keyword with the file they should find, embedded by
other models of the same width. The right file came first in 15 of 15 with
`bge-large-en-v1.5` itself; in 14 with `gte-large`, from another lab; in 15
with `mxbai-embed-large-v1`, from a third; in 2 with `e5-large-v2`, the same
architecture and vocabulary; in 0 with `bge-m3`, from BAAI as well. Chance
gives 1.5. Every similarity of the last two lay between −0.11 and 0.05, under
the 0.25 floor, so those searches would have come back empty rather than
wrong.

So the decision above says too much: a distance across two models is
sometimes as good as one within a model. But neither the lab, nor the
architecture, nor the width told which pairs those were, and that is the
reason for the filter. `bge-m3` ran quantized to eight bits; the same
quantization of `bge-large-en-v1.5` changed none of its answers. Measured with
Transformers.js 4.3.0 on each model's ONNX export; the paid model this
deployment can switch to, `voyage-4`, was not measured.
