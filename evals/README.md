# Search evals

Does search by meaning find the file a person means? This measures it,
instead of trusting that a demo query looked right.

## What is measured

The retrieval half of search by meaning, as the app runs it:

- a file is indexed as the text `embeddingInput` builds in
  `libs/core/src/ai.ts`: its name, the sentence a model wrote about it, and its
  tags, embedded as a *document*;
- what a person types is embedded as a *query*;
- `match_files` (migrations/011) returns the most similar files by cosine
  similarity, at most 15, none below 0.25.

The report gives recall@5, MRR and nDCG@10, and **empty**: the number of
queries for which nothing cleared the floor, which is what a person sees as "no
results". It gives each per language; for the queries that can only be
answered across languages (`across`) and for the rest (`same`); and for all
queries together. A query's language alone does not say which test it is: a
Russian question about a Russian contract and one about a photograph, which
the model describes in English, are different tests.

Forty queries per language are enough to see a model fail a language, but not
to rank two models that are close: a share measured on 40 queries moves by
about ±0.15 at 95%. Comparing two models wants the same queries for both and
a paired test.

Not measured yet: how good the sentence is. That is the describe step, and it
is evaluated separately, once retrieval has a baseline to hold it to.

## The data

`data/corpus.jsonl` holds the files and `data/queries.jsonl` the questions, one
JSON object per line:

```json
{"id": "f01", "lang": "en", "name": "invoice-2026-03-electricity.pdf", "summary": "An electricity invoice…", "tags": ["invoice", "electricity"]}
{"id": "q06", "lang": "es", "text": "factura de la luz", "relevant": {"f01": 3, "f29": 3, "f60": 2}}
```

A file a query does not list is not relevant to it; how the grades are given
is below. A summary is in the language of the writing in the file, and in
English where there is none, as the describe prompt asks
(`libs/server/src/describe.ts`): a scanned Spanish receipt is described in
Spanish, a photograph of a dog in English.

There are 60 files and 120 queries, 40 queries in each of English, Spanish
and Russian. 65 of the queries can only be answered across languages: no file
they mean is in the language they are asked in, such as a Spanish question
about an English invoice. 34 of those are about pictures: 25 about ones
described in English and 9 about pictures of Spanish papers. That is the
hypothesis the first run tests: `bge-large-en-v1.5`, the Workers AI model, is
English-only.

How the grades are given:

- **3:** what the query asks for. A query that names a kind rather than one
  file ("extracto bancario", "all photos of dogs") can have several.
- **2:** a near miss the person would still take. That is the same document for
  another period (the March bill for "April"), or the same thing in another
  form (an e-ticket for "boarding pass").
- **1:** a file tied to the same occasion. For example, the flight of the trip
  whose taxi receipt is asked for, or the bank statement that holds the rent
  transfer.
- **Nothing:** a file that only shares a broad category. A car insurance
  policy is not labelled for "home insurance", a speeding fine for "parking
  fine", nor the vacuum cleaner's manual for the washing machine's. Those are
  the hard negatives: recall and MRR count a file of any grade as found, so
  labelling them at all would score a miss as a hit.

Every query has a file graded 3, and every file is labelled for some query. All
but one are what some query asks for; the water bill is only ever a near miss.
Every label is a claim a reviewer can read in the diff.

## Results

First run, 20.11.2026, with the vectors in `cache/`. Every number is the mean
over the queries in the row; 1.0 is perfect. `score` prints these tables, and
CI prints them again on every run.

| | queries | Voyage `voyage-4` | Workers AI `bge-large-en-v1.5` | Workers AI `bge-m3` |
|---|---|---|---|---|
| en | 40 | 0.983 | 0.829 | 0.967 |
| es | 40 | 0.975 | 0.600 | 1.000 |
| ru | 40 | 0.963 | **0.263** | 0.970 |
| same language | 55 | 0.991 | 0.934 | 0.987 |
| across languages | 65 | 0.959 | **0.251** | 0.972 |
| all | 120 | 0.974 | 0.564 | 0.979 |

That is recall@5 at 15 results and a floor of 0.25, the app's settings for
every model at the time. `bge-m3` now searches at 0.40 (ADR 0016), where every
number in its column is the same. MRR and nDCG@10 tell the same story (all queries: 0.990 / 0.984 for Voyage, 0.598 /
0.584 for `bge-large-en-v1.5`, 0.969 / 0.967 for `bge-m3`).

- **The hypothesis held.** `bge-large-en-v1.5`, the model the app fell back
  to without Anthropic and Voyage keys until ADR 0016, finds what a Russian query
  means about one time in four, and almost never crosses languages. In one
  language it is fine (0.934).
- **`bge-m3`, also on Workers AI and also 1024 dimensions, is as good as
  Voyage here.** The gap between them is inside the noise of 40 queries per
  language (about ±0.15); the gap to `bge-large-en-v1.5` is not.
- **The floor is a property of the model, not of the search.** At 0.25,
  Voyage shows 11.6 results on average and cuts 73% of the query–file pairs.
  Every pair `bge-large-en-v1.5` scores is above 0.32, and `bge-m3` puts 91%
  of them above 0.25, so for both the search returns all 15 to every query and
  never says "nothing found". For `bge-m3`, a floor of 0.40 keeps recall@5 at
  0.979 and shows 9.9 results on average; 0.50 starts to lose what was asked
  for (0.929). The app now gives each model its own floor: `SEARCH_FLOORS` in
  `libs/core/src/ai.ts`, which `score` uses unless `--min-similarity` says
  otherwise.
- **Voyage is near the ceiling.** This set can tell a model that fails a
  language from one that does not; it cannot rank two good models. That needs
  harder queries, and summaries written by the describe step rather than for
  the test.

## Running it

uv brings the Python in `.python-version` and the locked dependencies:

```sh
brew install uv                # once
cd evals
uv run pytest                  # the tests, offline
uv run search-evals check      # what is wrong with data/, if anything

# Vectors cost a little and need a key; fetch only what cache/ is missing.
uv run --env-file ../.env search-evals embed --model voyage-4
uv run --env-file ../.env search-evals embed --model @cf/baai/bge-large-en-v1.5
uv run --env-file ../.env search-evals embed --model @cf/baai/bge-m3

# Offline, from cache/, as often as you like.
uv run search-evals score --model voyage-4             # at the app's floor for it
uv run search-evals score --model @cf/baai/bge-m3 --min-similarity 0.50
```

Vectors are kept in `cache/`, one file per model, filed under a hash of the
text and the side of the search, and committed: anyone, CI included, can score
without a key. Change a summary or a query's wording, and
`embed` fetches that one again.

## The metrics and the ranking

`src/search_evals/metrics.py` holds recall@k, reciprocal rank and nDCG@k, and
`src/search_evals/rank.py` what `match_files` returns. Their tests in
`tests/test_metrics.py` and `tests/test_rank.py` are the specification, with
every expected value worked out by hand.

## Kept in step with the app

The eval cannot import TypeScript, and a copy that drifts does not throw. The
values both sides depend on are written once, in
`libs/core/src/ai.eval-contract.json`: the embedding model, the dimensions, the
limits of the table, the result count, the floors, and the cases of
`embeddingInput`. `libs/core/src/ai.test.ts` holds the app to that file, and
`tests/test_contract.py` holds this to it.

## Dependencies

`exclude-newer` in `pyproject.toml` keeps out anything published in the two
weeks before the lock was made. Moving that date and running `uv lock` is how
the dependencies are updated.
