"""`search-evals embed` fetches vectors; `search-evals score` measures with them.

They are two commands because they need different things. `embed` needs a key
and the network, costs a little, and is run when the data or the model
changes. `score` needs neither, so it runs in CI on the vectors in `cache/`,
and it is the one run again and again while a threshold or a ranking is tuned.

`embed-chunks` and `score-chunks` are the same pair for the pieces of text a
question is answered from (`retrieval.py`), at each size compared.
"""

from __future__ import annotations

import argparse
import statistics
import sys

import numpy as np

from . import metrics, retrieval
from .backends import MissingKey, embedder
from .contract import EMBEDDING_MODEL, SEARCH_RESULTS, embedding_input, search_floor
from .data import LANGUAGES, load_files, load_queries, only_across_languages, problems
from .documents import across_languages, load_documents, load_questions
from .documents import problems as document_problems
from .rank import rank
from .vectors import VectorCache


def _check() -> int:
    found = problems(load_files(), load_queries()) + document_problems(load_documents(), load_questions())
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
    args = parser.parse_args(argv)
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
