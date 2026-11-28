# 0019 — Questions are answered from pieces of the files

Accepted · v4.17.0 · written before most of the work it decides, like
[0014](0014-the-public-pages-are-a-second-app.md), and amended as each piece
ships ·
[`evals/src/search_evals/chunks.py`](../../evals/src/search_evals/chunks.py),
[`evals/src/search_evals/retrieval.py`](../../evals/src/search_evals/retrieval.py),
[`libs/core/src/chunks.ts`](../../libs/core/src/chunks.ts),
[`migrations/022`](../../migrations/022_add_file_chunks.sql),
[`libs/server/src/answer.ts`](../../libs/server/src/answer.ts),
[`migrations/023`](../../migrations/023_count_questions.sql)

## Context

Search by meaning ([0013](0013-search-by-meaning-is-indexed-on-demand.md),
[0016](0016-the-free-path-searches-with-bge-m3.md)) finds a file by what it is
about. The next thing a person wants is to ask what a file says: "until when
does my lease run", "how much was the electricity in March". The usual name
for this is retrieval-augmented generation: find the passages that hold the
answer, and have a model answer from them and from nothing else.

The index cannot do that as it is. It keeps one sentence per file, at most 500
characters, written by a model to say what the file is about. "A lease for a
flat in Valencia for 12 months at 950 euros a month" answers two questions
about the lease, and not the twenty others its clauses answer.

## Decision

**A file's text is cut into pieces, each piece is embedded, and a question is
answered from the pieces nearest to it.**

- **Pieces of at most 400 characters, each repeating about 15% of the one
  before.** Measured, not chosen: `evals/` compared 400, 800, 1200 and 1600
  over fifteen files in three languages and 65 questions whose answers are
  marked by exact quotes. With `bge-m3`, the model production embeds with, 400
  is the best size on every measure, and the cheapest to read:

  | Size | recall@3 | all@5 | MRR | context@5 |
  | ---: | ---: | ---: | ---: | ---: |
  | **400** | **1.000** | **1.000** | **0.928** | **1,575** |
  | 800 | 0.954 | 0.985 | 0.880 | 3,030 |
  | 1200 | 0.969 | 0.969 | 0.909 | 4,072 |
  | 1600 | 0.938 | 0.985 | 0.912 | 4,905 |

  Voyage, the paid path, finds every answer in the first three pieces at every
  size; with larger pieces it puts the answer first a little more often (MRR
  0.936 at 400, 0.985 at 800) for twice the reading and more. One size for
  both paths.
- **The cut follows the text's own shape.** A piece is whole paragraphs; a
  paragraph too long for one splits into sentences, a sentence into runs of
  words. A piece is a slice of the text as written, so what it says can be
  found in the file. No quote was split at any size.
- **Characters, not tokens.** The size has to mean the same in the Python that
  measures it and in the TypeScript that runs it, without a tokenizer in a
  function. `chunks.py` is the specification, and its tests are the cases the
  app's cut is held to.
- **A piece is embedded with the file's name in front.** "Importe total a
  pagar: 86,40 euros" does not say it is electricity, or March;
  `factura-luz-marzo-2026.pdf` does.

What follows, decided here and amended as each part ships:

- **Pieces are rows of their own** (migration 022), beside the sentence per
  file, under the same row-level security, written when a file is indexed and
  deleted with it. The demo gets its pieces from a prepared index, as it gets
  its sentences now.
- **The answer comes from a model told to use the pieces and nothing else**:
  Workers AI on the free path production runs, Claude on the paid one. It names
  the files it used, and the app shows them as links. With nothing to answer
  from, it says so.
- **A file's text is data, never instructions.** The model has no tools, so a
  file that tries to give it orders can change only the answer its own owner
  reads; the answer is shown as text, never as HTML.
- **Each question claims a unit of the daily budget** of
  [migration 017](../../migrations/017_bound_ai_spend.sql), and the action has
  a per-account limit.
- **The answers are measured too**, in `evals/`: whether every claim is in the
  pieces read, whether the files named hold the answer, whether a question with
  no answer gets "not in your files", and how close the answer is to the
  reference. The model's answers are recorded, like the vectors, so CI scores
  them without a key.

## Consequences

- **Fifteen files is an easy haystack.** Recall at the ceiling says the cut
  keeps answers whole and the model finds them among these; it does not say how
  it holds among a thousand files. The set grows when the answers' eval shows
  where it is too easy.
- **400 characters may be too little to answer from.** A clause without the
  paragraph around it can be found and still be misread. The answers' eval
  decides that; reading eight pieces instead of five still costs less than five
  of 800.
- **The free path still cannot read a PDF** ([0016](0016-the-free-path-searches-with-bge-m3.md)).
  Most of what people ask about is a PDF, so the pieces need its text.
  Cloudflare's `toMarkdown` gives it, on the account the free path already
  uses, free for a PDF and with no package of ours: four PDFs made from the
  eval's documents in three languages came back with all 19 of their quotes
  word for word. It reads a PDF's text layer and is not documented to read a
  scan. Its text has no blank lines between paragraphs, only the PDF's line
  breaks, so the cut works through sentences; no quote was split at 400. It
  also reads Word, Excel and PowerPoint files, which nothing on the free path
  reads today.
- **Indexing a file costs more**: one vector per piece, about ten for a page,
  rather than one per file.

## Amendments

- **Step 2a (2026-11-21).** The cut is in the app, `libs/core/src/chunks.ts`,
  and `ai.eval-contract.json` holds twenty cases both sides must cut the same:
  an emoji is one character, as Python and `char_length` count it and
  JavaScript does not; space is a set written out, since the two languages'
  own sets differ on U+FEFF and U+001C–U+001F. `CHUNK_SIZE` 400 and
  `CHUNK_OVERLAP` 60 are constants of the contract, and a file keeps at most
  200 pieces (`MAX_PIECES_PER_FILE`). Migration 022 adds `file_chunks` and
  `match_chunks`, as 011 added the sentence per file, with one thing more: a
  piece's owner is its file's owner by a key on both columns, as 018 made a
  file's folder its owner's, since these rows are the text itself. It was
  tried on production, twice over in a transaction that rolled back: the
  owner's search found the probe's pieces and another account's found none,
  the browser could not write, `anon` could not search, a piece of 401
  characters and a piece put under another owner were refused, and deleting
  the file took its pieces with it. Nothing writes to the table yet.

- **Step 2b (2026-11-21).** Indexing a file writes its pieces: `/api/ai/index`
  cuts a text file whole (the description reads only its start), a PDF from
  the text `toMarkdown` gives it, and a picture from its description; at most
  `MAX_PIECES_PER_FILE`, embedded in batches under the file's name, replacing
  whatever the file had. A file with a description and no pieces gets its
  pieces without being described again. The free path, which refused PDFs,
  now describes one from its text; Claude still reads one as it is, and its
  pieces are cut from `toMarkdown`'s text when the deployment has Cloudflare,
  from its description when it does not, or when `toMarkdown` fails for it. A
  text file is read as UTF-8 or, by its byte-order mark, UTF-16, and no NUL
  reaches a piece: Postgres refuses one, and a file saved as "Unicode" by
  Notepad could otherwise never be indexed. The dashboard counts a file as
  indexed by its first piece.

- **Step 2c (2026-11-21).** A demo account comes with its pieces, since a
  demo cannot index. `public/demo/search-index.json` carries each file's
  pieces and their vectors, cut by the same `piecesOf` the route uses
  (`libs/server/src/pieces.ts`), and `/api/demo/session` writes them with the
  sentence. Rebuilt with the free path: seven files and twelve pieces,
  `welcome.pdf` among them for the first time, read by `toMarkdown`. A test
  holds a text file's pieces to its cut and a picture's to its description's.
  The rebuild showed the free path's caption parser keeping "Tags: …" in the
  sentence when the model wrote both on one line; it splits there now, and the
  test refuses an index with tags in a sentence or a file with none.

- **Step 3 (2026-11-22).** `POST /api/ai/ask` answers. It claims a unit of
  the day's budget (a third action, `ask`, which migration 023 lets the table
  count: 20 an account and 100 for the deployment, inside Cloudflare's free
  allocation, for any account, a demo's included), embeds the question, and
  reads the eight nearest pieces through `match_chunks` as the caller, with
  their token, so that the database's policies decide whose pieces they are
  (`supabaseAsCaller`). The answer comes as lines of JSON: the numbered
  sources first, then the words as the model writes them, then `done`, or
  `error` once the stream has begun. With nothing indexed no model is asked.
  On the free path, mistral-small reads the pieces as text in a fence a file
  cannot close; on the paid one, Claude Opus 5.5 at low effort reads them as
  document blocks, with the server-side fallback on should it decline.
  Tried on Workers AI with the eval's documents before writing this: the
  first word in 0.4–1 s, every fact right, and a question with no answer
  answered "Your files don't say." Two things it took: told to answer "in the
  question's language", the model used the excerpts' instead, so the server
  names the language it reads from the question (`questionLanguage`, right
  for all 75 of the eval's questions); and one citation of five pointed at
  the piece next to the one holding the fact, which the answers' eval will
  count.
- **Step 4 (2026-11-23).** The screen: `/ask`, a page of its own, loaded when
  first opened, behind a button in the dashboard's bar wherever search by
  meaning is offered. The answer appears as it is written, as text and
  never as markup; each [n] in it opens the file it cites, and the pieces
  it cites are listed under it to be checked against. Stop, or leaving the
  page, ends the request, and the route then stops the model rather than
  finish an answer nobody reads out of the same free allocation. Vercel
  tells a function that its caller left only when `vercel.json` says
  `supportsCancellation` for it, so `api/ai/*.ts` does; the function is then
  ended on a disconnect, and an index of one file in flight when the tab is
  closed is lost with it, its unit spent, as it would be on a timeout.
  Checked in production on 2026-11-24, from a demo account: the same
  question, answered whole, ran 7.87 s (Execution Duration in Vercel's
  request log); aborted by the client after the first word, as Stop aborts
  it, 1.46 s. A spent
  limit says when the person can go on in their own time ("after 01:00"),
  from the moment every 429 now carries. The question, the answer and the
  files' names are kept from Hotjar and Sentry. The dashboard learns the
  index's model from the server (`/api/ai/model`, which asks no model), so
  "Index them" no longer waits for a search by meaning, and a file the
  route will not index is listed once with its reason instead of being
  offered again on every visit.
- **Step 5 (2026-11-24).** The answers' eval (`evals/`, "The answers"):
  every question asked as the app asks it, the answers kept in the
  repository and graded by rules, not by another model, in CI. On Workers
  AI's `mistral-small-3.1`, the free path: 62 of 65 answered right, 9 of the
  10 with no answer refused, every answer in the question's language, and
  no number in any of the 75 that the pieces do not hold. 400 characters
  were enough: the eight pieces held the evidence for every question, so
  every miss was the model's, and each of the three wrong answers was to a
  question asked in another language than its answer is written in. The fifteen files stay: the eval
  shows where the model fails, not where the search is too easy.
- **A copy of a file is read once (2026-11-27).** A file kept twice, a copy
  under another name, gives the same pieces as its original, and each would
  take a place of the eight. Production has such copies: the account Claude
  Code asked over MCP keeps one picture three times, and its one piece is
  there three times, 31 distinct texts in 33 pieces. Its copies of a CV are
  not indexed, so the wrong answer about the CV that started this was not
  theirs. Measured in `evals/` on the cached vectors, with a copy of the 2026
  CV added, the CV questions whose every quote was read went from 6 of 8 to
  5. The route now asks `match_chunks` for 16 pieces and reads the first
  eight whose text it has not read already (`distinctPieces` in
  `libs/server/src/answer.ts`; the eval drops them the same way, held to it
  by the cases in the contract). With the copy that is 6 of 8 again; with no
  copy nothing changes, and the eval's answers were not asked again. Reading
  12 pieces instead of 8 found every quote of every question, copy or not, at
  half as much text again. It is not taken here: more pieces holding other
  figures turned two answers into refusals (`evals/README.md`, "Two versions
  of one CV"), so it is measured on the answers first.
- **A tagged PDF is read without its tags when they hide its text
  (2026-11-28).** The four CVs that account could not index were refused as
  having no text, "a scanned page is a picture of text", and none of them is
  a scan: pypdf reads 3,332 to 3,723 characters from each. Three are exports
  from Canva, all four are tagged PDFs, and `toMarkdown` gave each a title
  and no page. Two that are indexed, one of them from Canva and tagged too,
  came back whole. Taken apart one change at a time, the structure tree is
  what does it: the same bytes with only `/StructTreeRoot` renamed came back
  with 3,262 to 3,663 characters, and written again with nothing changed
  came back empty. The other suspects did not hold: text put in a form
  XObject, a nested one or one with a transparency group was read in a test
  file, and the CVs saved or drawn again by macOS stayed empty. So `pdfText` asks once more, when the text is empty
  and the bytes name a tree, with the name changed in a copy, at the same
  length, so no offset moves; both tries share the 30 seconds. A tree that
  works is kept: a tagged Canva CV that reads gave 2,544 characters with it
  and 2,321 without. A catalog inside a compressed object stream is not seen
  by the rename, and such a file still gets the scan's reason.

## Alternatives

- **Answer from the sentence per file.** It answers what a file is, which
  search already does.
- **Give the model whole files.** A question would read every file a search
  returned, most of it beside the point, at many times the cost; and a long
  file would not fit.
- **Cut by tokens.** It matches what a model counts, but needs the same
  tokenizer on both sides of the measurement, and the two models of the two
  paths count differently anyway.
- **Larger pieces for Voyage.** Its MRR is higher at 800, but its recall is
  already 1.000 at 400, and one size keeps one index format.
