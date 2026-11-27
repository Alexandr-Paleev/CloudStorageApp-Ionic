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

## Answering from pieces of text

Asking a question of one's files ([decision 0019](../docs/decisions/0019-questions-are-answered-from-pieces-of-the-files.md))
needs more than the sentence the index keeps per file: "until when does my
lease run" is answered by a clause. A file's text is cut into pieces
(`src/search_evals/chunks.py`, the specification the app will follow), each
piece is embedded with the file's name in front of it, and a model answers
from the pieces nearest to the question. This measures the first half: whether
those pieces hold the answer.

**The data.** `data/documents/` holds fifteen made-up files, seven in English
and four each in Spanish and Russian: a lease, two electricity bills a month apart, a trip and a flight,
two insurance policies, a blood test, an offer letter, two manuals, a recipe,
meeting notes, a warranty and a gym's terms. The pairs are alike on purpose.
`data/questions.jsonl` asks 75 questions of them. Each of 65 names where its
answer is written, as **evidence**: quotes copied exactly from a document. A
piece answers when it holds a whole quote, so the same labels score every size
of piece. 36 are asked in another language than their answer is written in.
The other 10 have no answer in these files, for the eval of the answers.

**What is reported**, for each size: **recall@k**, the share of a question's
quotes that are whole in one of the first k pieces; **all@k**, the share of
questions with every quote there; **MRR**, one over the position of the first
piece holding any quote; **context@k**, the characters in the first k pieces,
which a model reads on every question; **split**, quotes that no piece holds
because a border fell through them.

**Results** (2026-11-21, overlap 15%, the first five pieces read):

| Model | Size | recall@3 | all@5 | MRR | context@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Workers AI `bge-m3` | **400** | **1.000** | **1.000** | **0.928** | **1,575** |
| | 800 | 0.954 | 0.985 | 0.880 | 3,030 |
| | 1200 | 0.969 | 0.969 | 0.909 | 4,072 |
| | 1600 | 0.938 | 0.985 | 0.912 | 4,905 |
| Voyage `voyage-4` | **400** | **1.000** | **1.000** | 0.936 | **1,504** |
| | 800 | 1.000 | 1.000 | 0.985 | 3,018 |
| | 1200 | 1.000 | 1.000 | 0.977 | 4,108 |
| | 1600 | 1.000 | 1.000 | 0.992 | 5,281 |

- **400 characters.** For `bge-m3`, the model production runs, it is the best
  size on every measure and the cheapest: all 65 answers are in the first
  three pieces, across languages too. Voyage finds every answer at every size
  and puts it first slightly more often with larger pieces, at three and a half
  times the reading.
- **No quote was split** at any size: a fact is a sentence or two, and the
  pieces are built from whole paragraphs and sentences.
- **Fifteen files is an easy haystack.** Recall at the ceiling says the pieces
  hold the answers and the model finds them among these; it does not say how
  it holds among a thousand. The answers' eval will say whether 400 characters
  are enough context to answer from.

## The answers

The second half: given those pieces, does the model answer right? `answer`
asks every question as the app does: the nearest 8 pieces of 400 characters
by `bge-m3`, no floor, and the same instruction and message, which
`libs/server/src/answer.eval-contract.json` holds both sides to. The answers
are kept in `cache/answers-<model>.jsonl`, one line each, and graded with no
model and no network (`src/search_evals/grading.py`, specified by
`tests/test_grading.py`):

- **correct**: the answer says every fact its question lists in
  `data/questions.jsonl`, and does not refuse. A fact is a few ways of saying
  it, matched as whole words, with numbers written one way: "1,900", "1.900"
  and "1 900" are the same. `check` fails a reference answer that does not
  pass its own facts.
- **refused**: it says one of the three sentences the instruction gives for
  "not in your files". Right for the ten questions the files do not answer,
  wrong for the rest.
- **evidence**: the share of a question's quotes that a piece the answer cites
  holds. **precision**: the share of cited pieces that hold a quote. It
  counts an extra citation of a piece with a true detail beyond the quote
  as a miss, so it is a floor.
- **numbers**: answers that state a number that neither their pieces nor the
  question contains. Invented amounts and dates are the harm here, and they
  are cheap to catch.
- **language**: the share of answers in the question's language, told by
  script and common words; a bare code or name is not counted.

No model grades another. A judge would read meaning these rules miss, and
would also move between two runs of the same answers; a rule moves only
when an answer does. What the rules cannot see is below.

Each answer is one sample. The app sets no temperature, so neither does
this, and asking again can change an answer or two; the cache keeps the one
graded, and CI grades that one. A difference of a question or two between
two models or two instructions is within that.

**Results** (2026-11-24, Workers AI `mistral-small-3.1-24b-instruct`, the
model production answers with, free):

| | questions | correct | refused | evidence | precision | numbers | language |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| en | 26 | 0.962 | 1 | 1.000 | 0.880 | 0 | 1.000 |
| es | 16 | 1.000 | 0 | 0.938 | 0.906 | 0 | 1.000 |
| ru | 23 | 0.913 | 1 | 1.000 | 0.856 | 0 | 1.000 |
| same language | 29 | 1.000 | 0 | 1.000 | 0.897 | 0 | 1.000 |
| across languages | 36 | 0.917 | 2 | 0.971 | 0.863 | 0 | 1.000 |
| all | 65 | **0.954** | 2 | 0.984 | 0.878 | **0** | **1.000** |

Of the ten questions with no answer, nine were refused, each in the
question's language.

- **Every miss is the model's.** The eight pieces held the evidence for all
  65 questions. Every question asked in the language its answer is written
  in was answered right.
- **The two wrong refusals cross languages.** "What number do I call if the
  power goes out?" and "На какую сумму застрахованы вещи в квартире?" each had
  their answer in the first piece, in Spanish: "Para averías, llame al…",
  "Contenido: 25.000 euros". The model did not tie *averías* to a power cut,
  nor *contenido* to one's belongings.
- **One answer is true and does not answer.** Asked whether baggage is in
  the Berlin fare, it said what is: one personal item. The piece's next line,
  "Not included: cabin bag and checked baggage", went unsaid.
- **One refusal was not given.** Asked for the Wi-Fi password, which no file
  holds, it said where the router's label prints it. That is in the manual,
  and useful, and still not what the instruction asks for when the answer is
  missing.
- **One citation points at the wrong piece.** The broth's 1.5 hours came
  from [3], and the answer cited [5], the list of ingredients. 13 answers
  cite more than one piece; most extra ones hold a true detail the answer
  adds.
- **No number was made up.** Every amount, date and time in the 75 answers
  is in the pieces the model read, or in the question.
- **Two facts were loosened after this run**, each because a right answer
  failed it: "how many components are migrated" asked for 41 and the fact
  also wanted the 58 there are; "no tiene conexión a Internet" was not among
  the ways of saying "no Internet". Both are in the diff of
  `data/questions.jsonl`; no answer was changed.

What the rules do not see: a mistranslation inside a right answer ("prospecto
Blasco Ibañez" for проспект, an avenue, read as a leaflet); a true
statement the pieces do not make, unless it carries a number; and a wrong
answer that happens to hold a fact that is a bare number, such as "30" or
"12", for another reason. `--verbose` lists every answer that fell short, and
reading the answers in the cache is still the check of last resort. A share near
0.95 measured on 65 questions moves by about ±0.05 at 95%: enough to see a
model fail a language or start making up amounts, not to rank two close
models.

## Choosing a tool

An assistant reaches the files through `/mcp` ([decision 0020](../docs/decisions/0020-agents-read-the-files-through-mcp.md)),
which offers it three tools: `search_files` finds files by meaning,
`ask_files` answers a question from what they say, `list_files` lists them,
by folder if asked. Which one it calls is the model's choice, made from what
the server tells it. This measures that choice: given a request a person
might make, does the model call the right tool, with arguments the server
takes, saying what was asked?

**The data.** `data/tool_requests.jsonl` holds 60 requests, 20 in each of
English, Spanish and Russian: in each, 6 to find a file, 6 questions about
what the files say, 5 to list them (2 with no folder, 2 naming a folder, 1
asking for the files in none), and 3 that no tool is for: to delete, share
or rename a file, which nothing here does, and the weather or a
translation. A request lists the tools that are right for it; one, "do I
have a document about home insurance?", takes either search or a question.
A query or a question must hold one of the request's terms, given in each
language the model might write it in, and a folder must be the one named,
compared as the route compares paths.

**What the model is told** is what `/mcp` tells an assistant, word for word:
the server's instructions as the system message, and the tools as
`tools/list` gives them. Both are in `libs/server/src/mcp.eval-contract.json`,
which `libs/server/src/mcp.test.ts` holds the server to. A real assistant's
client adds instructions of its own; this measures the server's words with
nothing in front of them. One request, one turn, one sample, no
temperature set.

**What is graded**, from the first call, with no model and no network
(`src/search_evals/tool_choice.py`, specified by `tests/test_tool_choice.py`):

- **tool**: the share of requests where the model called a right tool, or
  called none where none fits;
- **valid**: of the calls, the share whose arguments the tool's schema
  takes, as the server checks them before the tool runs;
- **args**: of the right calls, the share that say what was asked;
- **no call**: of the 9 requests no tool fits, the share left without one.

**Results** (2026-11-27, both on Workers AI, free):

| | requests | `mistral-small-3.1-24b-instruct` | `llama-3.3-70b-instruct-fp8-fast` |
| --- | ---: | ---: | ---: |
| tool, en | 20 | 1.000 | 0.850 |
| tool, es | 20 | 1.000 | 0.800 |
| tool, ru | 20 | 0.950 | 0.800 |
| **tool, all** | 60 | **0.983** | 0.817 |
| valid | | 1.000 | 0.983 |
| args | | 1.000 | 0.939 |
| **no call** | 9 | **0.889** | **0.000** |
| neurons | | 1,391 | 1,672 |

- **The three tools are told apart.** `mistral-small`, the model the app
  answers questions with, never called one of them for another: 18 searches,
  18 questions and 15 listings, each with arguments that say what was asked,
  every folder named right, the top given as "/". Its one miss: "Какая погода
  завтра в Москве?" went to `ask_files`.
- **`llama-3.3-70b` calls a tool for everything.** All 9 requests that no
  tool fits got one: "Delete the old electricity bills." became `ask_files`
  with "What are the old electricity bills?", "Share my lease with my
  landlord." became "How do I share my lease with my landlord?". No harm
  follows, since every tool only reads, but each spends a question of the
  person's daily allowance, and the assistant then says the files do not
  answer rather than that it cannot delete.
- **"Where is…" is a question to it.** "¿Dónde está mi contrato de trabajo?"
  and "Где скан моего паспорта?" went to `ask_files`, which answers from the
  files' text rather than naming the file.
- **It wrote two Russian queries in Latin letters**, "remont kuhni" and
  "polis OSAГO", which the search's model does not read as the Russian
  words. Six more Spanish and Russian requests it put in English, which the
  search crosses languages for.
- **One argument the server refuses:** `"limit": "1"`, a string where the
  schema says integer. The assistant gets the tool's error back.
- **The descriptions do the work.** Before this eval, one request to
  `mistral-small` with a sentence for each tool listed the folder "lease"
  for "When does my lease end?"; with the server's descriptions it asked.
  One sample, so an anecdote, but the reason the descriptions are held word
  for word.

Sixty requests measure a share near 0.9 to about ±0.08 at 95%, enough to see
one model call a tool for everything and the other not; the 9 requests with
no tool are few, and 8 of 9 against none of 9 is still not noise. Not
measured: a client's own instructions, which Claude and Cursor add; a model
that lists and then asks, over several turns; Claude itself, which costs per
run and is not wired in.

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

# The pieces: vectors for every size compared, then the table.
uv run --env-file ../.env search-evals embed-chunks --model @cf/baai/bge-m3
uv run search-evals score-chunks --model @cf/baai/bge-m3 --k 3

# The answers: about 3,000 to 4,000 neurons of Workers AI's free 10,000 a day
# for all 75, and only questions whose message changed are asked again.
uv run search-evals answer --dry-run
uv run --env-file ../.env search-evals answer
uv run search-evals score-answers --verbose   # offline; --verbose lists every miss

# The tools of /mcp: about 1,400 to 1,700 neurons for the 60 requests, per model.
uv run search-evals choose --dry-run
uv run --env-file ../.env search-evals choose --model @cf/meta/llama-3.3-70b-instruct-fp8-fast
uv run search-evals score-tools --verbose     # offline; the default model is mistral-small
```

Voyage on an account without a payment method allows three requests a minute;
`embed` waits a rate limit out and goes on.

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

The answers have their own, beside the code it describes:
`libs/server/src/answer.eval-contract.json` holds the answering model, the
number of pieces and the token limit, the instruction word for word, its
three refusals, and cases of `questionLanguage` and `excerptsAsText` with
the message each one writes. `libs/server/src/answer.test.ts` holds the app
to it; `src/search_evals/prompt.py` is the Python copy those cases test.

## Dependencies

`exclude-newer` in `pyproject.toml` keeps out anything published in the two
weeks before the lock was made. Moving that date and running `uv lock` is how
the dependencies are updated.
