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
results". It gives each per language and for all queries together.

Not measured yet: how good the sentence is. That is the describe step, and it
is evaluated separately, once retrieval has a baseline to hold it to.

## The data

`data/corpus.jsonl` holds the files and `data/queries.jsonl` the questions, one
JSON object per line:

```json
{"id": "f01", "lang": "en", "name": "invoice-2026-03-electricity.pdf", "summary": "An electricity invoice…", "tags": ["invoice", "electricity"]}
{"id": "q06", "lang": "es", "text": "factura de la luz", "relevant": {"f01": 3, "f02": 1}}
```

A grade of 3 is the file the person means, 2 a file they would be glad to see,
1 one that is related. A file a query does not list is not relevant to it.
Summaries are in the language of the file and English for pictures, as the
describe prompt asks (`libs/server/src/describe.ts`).

There are 60 files and 120 queries, 40 queries in each of English, Spanish
and Russian. In 65 of the queries the file meant is in another language than
the question, such as a Spanish question about an English invoice. Most of
those are pictures, which the model describes in English whatever the person
speaks. That is the hypothesis the first run tests: `bge-large-en-v1.5`, the
Workers AI model, is English-only. Some files are near misses on purpose, such
as the electricity bills of March and April, or a car insurance policy beside
a home one. Every query has a file graded 3, and every file is asked about.
Every label is a claim a reviewer can read in the diff.

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

# Offline, from cache/, as often as you like.
uv run search-evals score --model voyage-4
uv run search-evals score --model voyage-4 --min-similarity 0.35
```

Vectors are kept in `cache/`, one file per model, filed under a hash of the
text and the side of the search. Change a summary or a query's wording, and
`embed` fetches that one again.

## What is yours to write

`src/search_evals/metrics.py` (recall@k, reciprocal rank, nDCG@k) and
`src/search_evals/rank.py` (what `match_files` returns) raise
`NotImplementedError`. Their tests in `tests/test_metrics.py` and
`tests/test_rank.py` are the specification, with every expected value worked
out by hand, and they are skipped until the function exists rather than
failed. `search-evals score` says which one is still missing.

## Kept in step with the app

The eval cannot import TypeScript, and a copy that drifts does not throw. The
values both sides depend on are written once, in
`libs/core/src/ai.eval-contract.json`: the embedding model, the dimensions, the
limits of the table, the result count, the floor, and the cases of
`embeddingInput`. `libs/core/src/ai.test.ts` holds the app to that file, and
`tests/test_contract.py` holds this to it.

## Dependencies

`exclude-newer` in `pyproject.toml` keeps out anything published in the two
weeks before the lock was made. Moving that date and running `uv lock` is how
the dependencies are updated.
