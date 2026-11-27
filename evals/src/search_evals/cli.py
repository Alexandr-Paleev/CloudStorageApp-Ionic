"""`search-evals embed` fetches vectors; `search-evals score` measures with them.

They are two commands because they need different things. `embed` needs a key
and the network, costs a little, and is run when the data or the model
changes. `score` needs neither, so it runs in CI on the vectors in `cache/`,
and it is the one run again and again while a threshold or a ranking is tuned.

`embed-chunks` and `score-chunks` are the same pair for the pieces of text a
question is answered from (`retrieval.py`), at each size compared.

`answer` and `score-answers` are the pair for the answers themselves: the
first asks the model every question from the pieces the app would give it,
the second grades what it said (`grading.py`).

`choose` and `score-tools` are the pair for the tools of `/mcp`: the first
asks a model what it would call for each request a person might make of an
assistant, the second grades the calls (`tool_choice.py`).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys

import numpy as np

from . import metrics, retrieval
from .answers import Answer, AnswerCache, message_hash
from .backends import MissingKey, cloudflare_answer, cloudflare_tools, embedder
from .contract import (
    ANSWER_MODEL,
    ANSWER_SYSTEM,
    CHUNK_SIZE,
    EMBEDDING_MODEL,
    EXCERPTS_PER_QUESTION,
    MAX_ANSWER_TOKENS,
    SEARCH_RESULTS,
    embedding_input,
    search_floor,
)
from .data import LANGUAGES, load_files, load_queries, only_across_languages, problems
from .documents import Question, across_languages, load_documents, load_questions
from .grading import Grade, grade
from .prompt import Excerpt, excerpts_as_text
from .documents import problems as document_problems
from .rank import rank
from .vectors import VectorCache
from . import tool_choice
from .tool_choice import Call, Choice, ChoiceCache, ChoiceGrade, Request, grade_choice


def _check() -> int:
    found = (
        problems(load_files(), load_queries())
        + document_problems(load_documents(), load_questions())
        + tool_choice.problems(tool_choice.load_requests())
    )
    for problem in found:
        print(problem, file=sys.stderr)
    return 1 if found else 0


def _embed(model: str) -> int:
    files, queries = load_files(), load_queries()
    wanted = [(embedding_input(f.name, f.summary, f.tags), "document") for f in files]
    wanted += [(q.text, "query") for q in queries]
    return _fetch(model, wanted)


def _fetch(model: str, wanted: list[tuple[str, str]]) -> int:
    cache = VectorCache(model)
    todo = cache.missing(wanted)
    if not todo:
        print(f"{model}: all {len(wanted)} vectors are cached in {cache.path.name}")
        return 0
    fetched = 0
    try:
        for side in ("document", "query"):
            texts = [text for text, s in todo if s == side]
            if texts:
                for text, vector in zip(texts, embedder(model)(texts, side, model), strict=True):
                    cache.put(text, side, vector)
                    fetched += 1
    except MissingKey as error:
        print(f"{model}: {error}", file=sys.stderr)
        return 2
    finally:
        # What did arrive is kept, so a run that fails halfway is not paid twice.
        if fetched:
            cache.save()
    print(f"{model}: fetched {fetched}, {len(cache)} in {cache.path.name}")
    return 0


def _score(model: str, limit: int, min_similarity: float) -> int:
    files, queries = load_files(), load_queries()
    found = problems(files, queries)
    if found:
        # A score of data with a dangling label or an unknown language is a
        # number about a mistake; `check` names them.
        print(f"data/ has {len(found)} problems; run `search-evals check`", file=sys.stderr)
        return 1
    by_id = {f.id: f for f in files}
    cache = VectorCache(model)
    ids = [f.id for f in files]
    doc_vectors = [cache.get(embedding_input(f.name, f.summary, f.tags), "document") for f in files]
    query_vectors = [cache.get(q.text, "query") for q in queries]
    # `is None`, not `list.count(None)`: count compares with ==, and a numpy
    # array compared with None is an array, whose truth value is an error.
    missing = sum(v is None for v in doc_vectors) + sum(v is None for v in query_vectors)
    if missing:
        print(f"{model}: {missing} vectors are not cached; run `search-evals embed --model {model}`", file=sys.stderr)
        return 2
    documents = np.stack(doc_vectors)

    groups = (*LANGUAGES, "same", "across")
    rows: dict[str, list[tuple[float, float, float, bool]]] = {group: [] for group in groups}
    for q, vector in zip(queries, query_vectors, strict=True):
        ranked = [file_id for file_id, _ in rank(vector, documents, ids, limit=limit, min_similarity=min_similarity)]
        row = (
            metrics.recall_at_k(ranked, q.relevant, 5),
            metrics.reciprocal_rank(ranked, q.relevant),
            metrics.ndcg_at_k(ranked, q.relevant, 10),
            not ranked,
        )
        rows[q.lang].append(row)
        rows["across" if only_across_languages(q, by_id) else "same"].append(row)

    print(f"{model}, limit {limit}, min similarity {min_similarity}")
    print(f"{'':6}{'queries':>8}{'recall@5':>10}{'MRR':>8}{'nDCG@10':>9}{'empty':>7}")
    everything = [row for lang in LANGUAGES for row in rows[lang]]
    for label, group in [*((g, rows[g]) for g in groups), ("all", everything)]:
        if group:
            recall, rr, ndcg = (statistics.fmean(row[i] for row in group) for i in range(3))
            empty = sum(row[3] for row in group)
            print(f"{label:6}{len(group):>8}{recall:>10.3f}{rr:>8.3f}{ndcg:>9.3f}{empty:>7}")
    return 0


def _embed_chunks(model: str, sizes: list[int]) -> int:
    documents, questions = load_documents(), load_questions()
    wanted = [(p.input, "document") for size in sizes for p in retrieval.pieces(documents, size)]
    # Every question, those with no answer too: the answers' eval will ask them all.
    wanted += [(q.text, "query") for q in questions]
    return _fetch(model, wanted)


def _score_chunks(model: str, sizes: list[int], k: int) -> int:
    documents, questions = load_documents(), load_questions()
    found = document_problems(documents, questions)
    if found:
        for problem in found:
            print(problem, file=sys.stderr)
        return 1
    by_id = {d.id: d for d in documents}
    answerable = [q for q in questions if q.answerable]
    cache = VectorCache(model)
    by_size = {size: retrieval.pieces(documents, size) for size in sizes}
    wanted = [p.input for size in sizes for p in by_size[size]]
    if any(cache.get(text, "document") is None for text in wanted) or any(
        cache.get(q.text, "query") is None for q in answerable
    ):
        print(f"{model}: vectors are missing; run `search-evals embed-chunks --model {model}`", file=sys.stderr)
        return 2
    query_vectors = [cache.get(q.text, "query") for q in answerable]

    print(f"{model}: pieces of each size, the first {k} read; overlap {retrieval.OVERLAP_SHARE:.0%}")
    print(
        f"{'size':>5}{'':8}{'questions':>10}{'pieces':>8}{'recall@3':>10}"
        f"{f'recall@{k}':>10}{f'all@{k}':>8}{'MRR':>7}{f'context@{k}':>12}{'split':>7}"
    )
    for size in sizes:
        all_pieces = by_size[size]
        matrix = np.stack([cache.get(p.input, "document") for p in all_pieces])
        text_of = {p.id: p.text for p in all_pieces}
        rows: dict[str, list[tuple[float, float, float, float, int]]] = {"all": [], "same": [], "across": []}
        for q, vector in zip(answerable, query_vectors, strict=True):
            ids = [piece_id for piece_id, _ in rank(vector, matrix, [p.id for p in all_pieces], limit=50, min_similarity=-1.0)]
            ranked = [text_of[piece_id] for piece_id in ids]
            quotes = [e.quote for e in q.evidence]
            row = (
                retrieval.recall(ranked, quotes, 3),
                retrieval.recall(ranked, quotes, k),
                retrieval.reciprocal_rank(ranked, quotes),
                float(sum(len(text) for text in ranked[:k])),
                retrieval.split(all_pieces, quotes),
            )
            rows["all"].append(row)
            rows["across" if across_languages(q, by_id) else "same"].append(row)
        for label, group in rows.items():
            if not group:
                continue
            r3, rk, rr, context = (statistics.fmean(row[i] for row in group) for i in range(4))
            complete = statistics.fmean(row[1] == 1.0 for row in group)
            cut = sum(row[4] for row in group)
            print(
                f"{size if label == 'all' else '':>5}  {label:6}{len(group):>10}"
                f"{len(all_pieces) if label == 'all' else '':>8}{r3:>10.3f}{rk:>10.3f}{complete:>8.3f}"
                f"{rr:>7.3f}{context:>12.0f}{cut:>7}"
            )
    return 0


# The free path's embedding model, the one production searches the pieces with.
PIECES_MODEL = "@cf/baai/bge-m3"


def _asked(embedding_model: str) -> list[tuple[Question, list[retrieval.Piece], str]] | None:
    """Every question with the pieces the app would give it and the message it would send.

    The pieces are those `match_chunks` returns: the nearest of all the files'
    pieces at the app's size, no floor, the first EXCERPTS_PER_QUESTION.
    """
    documents, questions = load_documents(), load_questions()
    by_id = {d.id: d for d in documents}
    all_pieces = retrieval.pieces(documents, CHUNK_SIZE)
    cache = VectorCache(embedding_model)
    vectors = [cache.get(p.input, "document") for p in all_pieces]
    query_vectors = [cache.get(q.text, "query") for q in questions]
    if any(v is None for v in vectors) or any(v is None for v in query_vectors):
        print(f"{embedding_model}: vectors are missing; run `search-evals embed-chunks --model {embedding_model}`", file=sys.stderr)
        return None
    matrix = np.stack(vectors)
    piece_by_id = {p.id: p for p in all_pieces}
    out = []
    for q, vector in zip(questions, query_vectors, strict=True):
        nearest = rank(vector, matrix, [p.id for p in all_pieces], limit=EXCERPTS_PER_QUESTION, min_similarity=0.0)
        given = [piece_by_id[piece_id] for piece_id, _ in nearest]
        excerpts = [Excerpt(n=i, file_name=by_id[p.doc].name, content=p.text) for i, p in enumerate(given, start=1)]
        out.append((q, given, excerpts_as_text(excerpts, q.text)))
    return out


def _answer(model: str, embedding_model: str, dry_run: bool) -> int:
    # Workers AI is the one backend this asks; Claude, the paid path, costs
    # money per run and is not wired in.
    if not model.startswith("@cf/"):
        print(f"{model}: only Workers AI models (@cf/…) can answer here", file=sys.stderr)
        return 2
    asked = _asked(embedding_model)
    if asked is None:
        return 2
    cache = AnswerCache(model)
    todo = [(q, given, user) for q, given, user in asked if cache.get(q.id, message_hash(model, ANSWER_SYSTEM, user, MAX_ANSWER_TOKENS)) is None]
    if not todo:
        print(f"{model}: all {len(asked)} answers are cached in {cache.path.name}")
        return 0
    if dry_run:
        # About four characters a token in English, fewer in Russian: a ceiling, not a bill.
        characters = sum(len(ANSWER_SYSTEM) + len(user) for _, _, user in todo)
        print(f"{model}: {len(todo)} questions to ask, about {characters:,} characters of input")
        return 0
    asked_now = 0
    try:
        for q, given, user in todo:
            digest = message_hash(model, ANSWER_SYSTEM, user, MAX_ANSWER_TOKENS)
            text = cloudflare_answer(ANSWER_SYSTEM, user, model, MAX_ANSWER_TOKENS)
            cache.put(Answer(id=q.id, message_hash=digest, pieces=[p.id for p in given], answer=text))
            asked_now += 1
            # Kept as it comes: a run stopped halfway is not paid for twice.
            cache.save()
            print(f"{q.id}: {text[:100]!r}")
    except MissingKey as error:
        print(f"{model}: {error}", file=sys.stderr)
        return 2
    print(f"{model}: asked {asked_now}, {len(cache)} in {cache.path.name}")
    return 0


def _mean(values: list[float]) -> str:
    return f"{statistics.fmean(values):.3f}" if values else "—"


def _score_answers(model: str, embedding_model: str, verbose: bool) -> int:
    documents, questions = load_documents(), load_questions()
    found = document_problems(documents, questions)
    if found:
        print(f"data/ has {len(found)} problems; run `search-evals check`", file=sys.stderr)
        return 1
    asked = _asked(embedding_model)
    if asked is None:
        return 2
    by_id = {d.id: d for d in documents}
    cache = AnswerCache(model)
    graded: list[tuple[Question, Grade, str]] = []
    missing = 0
    for q, given, user in asked:
        row = cache.get(q.id, message_hash(model, ANSWER_SYSTEM, user, MAX_ANSWER_TOKENS))
        if row is None:
            missing += 1
            continue
        g = grade(
            row.answer,
            q.text,
            [list(alternatives) for alternatives in q.facts],
            [e.quote for e in q.evidence],
            [p.text for p in given],
        )
        graded.append((q, g, row.answer))
    if missing:
        print(f"{model}: {missing} answers are missing or stale; run `search-evals answer --model {model}`", file=sys.stderr)
        return 2

    print(f"{model}, from the first {EXCERPTS_PER_QUESTION} pieces of {CHUNK_SIZE} characters by {embedding_model}")
    print("Questions the files answer:")
    print(
        f"{'':8}{'questions':>10}{'correct':>9}{'refused':>9}{'evidence':>10}"
        f"{'precision':>11}{'numbers':>9}{'language':>10}"
    )
    answerable = [(q, g) for q, g, _ in graded if q.answerable]
    groups: dict[str, list[tuple[Question, Grade]]] = {lang: [] for lang in LANGUAGES}
    groups |= {"same": [], "across": []}
    for q, g in answerable:
        groups[q.lang].append((q, g))
        groups["across" if across_languages(q, by_id) else "same"].append((q, g))
    groups["all"] = answerable
    for label, rows in groups.items():
        if not rows:
            continue
        told = [(q, g) for q, g in rows if g.language is not None]
        print(
            f"{label:8}{len(rows):>10}"
            f"{_mean([float(g.correct) for _, g in rows]):>9}"
            f"{sum(g.refused for _, g in rows):>9}"
            f"{_mean([g.evidence_cited for _, g in rows if g.evidence_cited is not None]):>10}"
            f"{_mean([g.citation_precision for _, g in rows if g.citation_precision is not None]):>11}"
            f"{sum(bool(g.numbers_not_in_excerpts) for _, g in rows):>9}"
            f"{_mean([float(g.language == q.lang) for q, g in told]):>10}"
        )
    print("Questions the files do not answer:")
    print(f"{'':8}{'questions':>10}{'refused':>9}{'numbers':>9}{'language':>10}")
    unanswerable = [(q, g) for q, g, _ in graded if not q.answerable]
    for label in (*LANGUAGES, "all"):
        rows = unanswerable if label == "all" else [(q, g) for q, g in unanswerable if q.lang == label]
        if not rows:
            continue
        told = [(q, g) for q, g in rows if g.language is not None]
        print(
            f"{label:8}{len(rows):>10}{sum(g.refused for _, g in rows):>9}"
            f"{sum(bool(g.numbers_not_in_excerpts) for _, g in rows):>9}"
            f"{_mean([float(g.language == q.lang) for q, g in told]):>10}"
        )

    if verbose:
        print("\nWhat fell short:")
        for q, g, text in graded:
            flaws = []
            if not g.correct:
                flaws.append("refused" if g.refused and q.answerable else "answered" if not q.answerable else f"facts {g.facts_said}/{g.facts}")
            if g.evidence_cited is not None and g.evidence_cited < 1:
                flaws.append(f"evidence cited {g.evidence_cited:.2f}")
            if g.citations_out_of_range:
                flaws.append(f"{g.citations_out_of_range} citations past the last piece")
            if g.numbers_not_in_excerpts:
                flaws.append(f"numbers not in the excerpts {list(g.numbers_not_in_excerpts)}")
            if g.language is not None and g.language != q.lang:
                flaws.append(f"answered in {g.language}")
            if flaws:
                print(f"{q.id} ({q.lang}) {'; '.join(flaws)}\n    Q: {q.text}\n    A: {text}")
    return 0

# The free models of Workers AI that call tools, measured side by side. The
# first is the one the app answers questions with.
TOOL_MODELS = ("@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast")


def _choose(model: str, dry_run: bool) -> int:
    if not model.startswith("@cf/"):
        print(f"{model}: only Workers AI models (@cf/…) are asked here", file=sys.stderr)
        return 2
    requests = tool_choice.load_requests()
    cache = ChoiceCache(model)
    todo = [r for r in requests if cache.get(r.id, tool_choice.message_hash(model, r.text)) is None]
    if not todo:
        print(f"{model}: all {len(requests)} choices are cached in {cache.path.name}")
        return 0
    if dry_run:
        tools = json.dumps(tool_choice.tools_payload(), ensure_ascii=False)
        characters = sum(len(tool_choice.MCP_INSTRUCTIONS) + len(tools) + len(r.text) for r in todo)
        print(f"{model}: {len(todo)} requests to ask, about {characters:,} characters of input")
        return 0
    asked = 0
    neurons = 0.0
    try:
        for r in todo:
            calls, content, cost = cloudflare_tools(
                tool_choice.MCP_INSTRUCTIONS, r.text, tool_choice.tools_payload(), model, tool_choice.MAX_CHOICE_TOKENS
            )
            cache.put(
                Choice(
                    id=r.id,
                    message_hash=tool_choice.message_hash(model, r.text),
                    calls=[Call(name, arguments) for name, arguments in calls],
                    content=content,
                    neurons=cost,
                )
            )
            asked += 1
            neurons += cost or 0.0
            # Kept as it comes: a run stopped halfway is not paid for twice.
            cache.save()
            said = ", ".join(f"{name}({arguments})" for name, arguments in calls) or f"no call: {(content or '')[:60]!r}"
            print(f"{r.id}: {said}")
    except MissingKey as error:
        print(f"{model}: {error}", file=sys.stderr)
        return 2
    print(f"{model}: asked {asked} for {neurons:,.0f} neurons, {len(cache)} in {cache.path.name}")
    return 0


def _share(values: list[bool]) -> str:
    return f"{sum(values) / len(values):.3f}" if values else "—"


def _score_tools(model: str, verbose: bool) -> int:
    requests = tool_choice.load_requests()
    found = tool_choice.problems(requests)
    if found:
        print(f"data/ has {len(found)} problems; run `search-evals check`", file=sys.stderr)
        return 1
    cache = ChoiceCache(model)
    graded: list[tuple[Request, ChoiceGrade, Choice]] = []
    for r in requests:
        row = cache.get(r.id, tool_choice.message_hash(model, r.text))
        if row is None:
            print(
                f"{model}: {r.id} is missing or was asked of other tools; run `search-evals choose --model {model}`",
                file=sys.stderr,
            )
            return 2
        graded.append((r, grade_choice(r, row.calls), row))

    print(f"{model}, the tools and instructions of /mcp, one sample each")
    print(f"{'':8}{'requests':>9}{'tool':>8}{'valid':>8}{'args':>8}{'no call':>9}")
    for label in (*LANGUAGES, "all"):
        rows = [(r, g) for r, g, _ in graded if label == "all" or r.lang == label]
        called = [g for _, g in rows if g.valid is not None]
        right = [g for r, g in rows if r.tools and g.right_tool]
        none = [g for r, g in rows if not r.tools]
        print(
            f"{label:8}{len(rows):>9}"
            f"{_share([g.right_tool for _, g in rows]):>8}"
            f"{_share([bool(g.valid) for g in called]):>8}"
            f"{_share([bool(g.right_arguments) for g in right]):>8}"
            f"{_share([g.right_tool for g in none]):>9}"
        )
    kinds = (*tool_choice.TOOL_NAMES, "none")
    print("\nAsked for (rows), called first (columns):")
    print(f"{'':14}" + "".join(f"{k:>14}" for k in kinds) + f"{'other':>8}")
    for kind in kinds:
        rows = [g for r, g, _ in graded if tool_choice.expected_kind(r) == kind]
        counts = [sum((g.chosen or "none") == k for g in rows) for k in kinds]
        other = len(rows) - sum(counts)
        print(f"{kind:14}" + "".join(f"{c:>14}" for c in counts) + f"{other:>8}")
    several = sum(g.calls > 1 for _, g, _ in graded)
    spent = [c.neurons for _, _, c in graded if c.neurons is not None]
    print(f"\nMore than one call: {several}. Neurons: {sum(spent):,.0f} for {len(spent)} requests.")

    if verbose:
        print("\nWhat fell short:")
        for r, g, c in graded:
            if g.flaws:
                made = ", ".join(f"{call.name}({call.arguments})" for call in c.calls) or "no call"
                print(f"{r.id} ({r.lang}) {'; '.join(g.flaws)}\n    R: {r.text}\n    C: {made}")
                if c.content:
                    print(f"    S: {c.content[:200]}")
    return 0


def _sizes(text: str) -> list[int]:
    return [int(part) for part in text.split(",") if part.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="search-evals", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="find what is wrong with data/")
    for name, text in (("embed", "fetch the vectors cache/ is missing"), ("score", "measure with cached vectors")):
        command = commands.add_parser(name, help=text)
        command.add_argument("--model", default=EMBEDDING_MODEL)
        if name == "score":
            command.add_argument("--limit", type=int, default=SEARCH_RESULTS)
            # By default the floor the app uses for this model, so a score is the app's.
            command.add_argument("--min-similarity", type=float, default=None)
    for name, text in (
        ("embed-chunks", "fetch the vectors of the pieces and the questions"),
        ("score-chunks", "measure finding the pieces that answer, for each size"),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--model", default=EMBEDDING_MODEL)
        command.add_argument("--sizes", type=_sizes, default=list(retrieval.SIZES))
        if name == "score-chunks":
            command.add_argument("--k", type=int, default=5)
    for name, text in (
        ("answer", "ask the model every question; needs a key"),
        ("score-answers", "grade the cached answers"),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--model", default=ANSWER_MODEL)
        command.add_argument("--embedding-model", default=PIECES_MODEL)
        if name == "answer":
            command.add_argument("--dry-run", action="store_true", help="count what would be asked")
        else:
            command.add_argument("--verbose", action="store_true", help="show every answer that fell short")
    for name, text in (
        ("choose", "ask a model which tool of /mcp it calls for each request; needs a key"),
        ("score-tools", "grade the cached choices of tools"),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--model", default=TOOL_MODELS[0])
        if name == "choose":
            command.add_argument("--dry-run", action="store_true", help="count what would be asked")
        else:
            command.add_argument("--verbose", action="store_true", help="show every choice that fell short")
    args = parser.parse_args(argv)
    if args.command == "choose":
        return _choose(args.model, args.dry_run)
    if args.command == "score-tools":
        return _score_tools(args.model, args.verbose)
    if args.command == "answer":
        return _answer(args.model, args.embedding_model, args.dry_run)
    if args.command == "score-answers":
        return _score_answers(args.model, args.embedding_model, args.verbose)
    if args.command == "check":
        return _check()
    if args.command == "embed-chunks":
        return _embed_chunks(args.model, args.sizes)
    if args.command == "score-chunks":
        return _score_chunks(args.model, args.sizes, args.k)
    if args.command == "embed":
        return _embed(args.model)
    floor = search_floor(args.model) if args.min_similarity is None else args.min_similarity
    return _score(args.model, args.limit, floor)


if __name__ == "__main__":
    sys.exit(main())
