# 0016 — The free path searches with `bge-m3`, and each model has its own floor

Accepted · not released yet ·
[`libs/server/src/cloudflare-ai.ts`](../../libs/server/src/cloudflare-ai.ts),
[`libs/core/src/ai.ts`](../../libs/core/src/ai.ts),
[`evals/`](../../evals/README.md)

## Context

[0013](0013-search-by-meaning-is-indexed-on-demand.md) chose the models by
which keys exist: Claude and Voyage when both paid keys are set, Cloudflare
Workers AI otherwise, inside its free daily allowance. The free path embedded
with `bge-large-en-v1.5`. Whether it found what a person meant had not been
measured: 0013's update of 2026-10-29 measured distances *across* models, on
ten files and fifteen queries.

The eval in `evals/` now measures it, offline, from vectors kept in the
repository: 60 files and 120 queries, 40 each in English, Spanish and
Russian, 65 of which can only be answered across languages, such as a Spanish
question about an English invoice. recall@5 at the app's settings then, 15
results and a floor of 0.25:

| | Voyage `voyage-4` | Workers AI `bge-large-en-v1.5` | Workers AI `bge-m3` |
|---|---|---|---|
| Russian queries | 0.963 | 0.263 | 0.970 |
| across languages | 0.959 | 0.251 | 0.972 |
| all 120 | 0.974 | 0.564 | 0.979 |

Two things came out of it.

- **The free path was English-only.** In one language `bge-large-en-v1.5`
  is fine (0.934). Asked in Russian it found the file about one time in
  four, and across languages almost never. A free deployment would have
  shown a search that works in an English demo and fails anyone who searches
  in another language.
- **The floor of 0.25 was Voyage's.** It leaves out 73% of the query–file
  pairs there. `bge-large-en-v1.5` scores every pair above 0.32, and `bge-m3`
  91% of them above 0.25, so on either the search returned all fifteen to
  every query and never said "nothing found".

## Decision

**The free path embeds with `@cf/baai/bge-m3`.** It is on the same account,
inside the same allowance, with the same 1024 dimensions, so the table
needs no migration, and Workers AI answers for it in the same shape. In the
eval it keeps up with Voyage: the gap between them is inside the noise of 40
queries per language (about ±0.15); the gap to `bge-large-en-v1.5` is not.

**Each model searches with its own floor,** looked up by the name its
vectors carry: `SEARCH_FLOORS` in `libs/core/src/ai.ts`, 0.25 for `voyage-4`,
0.40 for `bge-m3`, and 0.25 for a model the eval has not measured. The name
already travels with the vector from `/api/ai/embed` to `match_files`
(0013), so the server still alone picks the backend and the browser reads the
floor off the answer. At 0.40 every number in `bge-m3`'s column is what it
was at 0.25, and it shows 9.9 results on average where Voyage shows 11.6;
0.50 starts to lose what was asked for (recall@5 0.929).

**The paid path does not change.** Nothing in the eval says to move Voyage.

## Consequences

- A free deployment that had indexed files with `bge-large-en-v1.5` sees them
  as not indexed: `match_files` and the dashboard's count both ask by model
  (0013), and the dashboard offers those files again. Production has the
  feature switched off and held no vectors when last checked (2026-10-30).
- Only the vectors change. The sentences are written as before, by
  `llava-1.5-7b` for a picture and `llama-3.1-8b-instruct` for text, and how
  good they are is not measured yet.
- The eval's summaries were written for the test, not by those models, and
  Voyage is near the ceiling: the set can tell a model that fails a language
  from one that does not, not rank two good ones. Moving either choice again
  wants a harder set and the describe step's own sentences.
- The floors are tuned on the same 120 queries they are reported on, and none
  of them asks for something that is not there. Whether 0.40 says "nothing
  found" when it should is not measured.
- `libs/core/src/ai.eval-contract.json` holds the floors alongside the other
  constants, and a test on each side holds that side to it. CI scores the
  three models from `evals/cache/` on every run, at the floors the app uses.
