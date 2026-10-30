"""`search-evals embed` fetches vectors; `search-evals score` measures with them.

They are two commands because they need different things. `embed` needs a key
and the network, costs a little, and is run when the data or the model
changes. `score` needs neither, so it runs in CI on the vectors in `cache/`,
and it is the one run again and again while a threshold or a ranking is tuned.
"""

from __future__ import annotations

import argparse
import statistics
import sys

import numpy as np

from . import metrics
from .backends import MissingKey, embedder
from .contract import EMBEDDING_MODEL, SEARCH_MIN_SIMILARITY, SEARCH_RESULTS, embedding_input
from .data import LANGUAGES, load_files, load_queries, only_across_languages, problems
from .rank import rank
from .vectors import VectorCache


def _check() -> int:
    found = problems(load_files(), load_queries())
    for problem in found:
        print(problem, file=sys.stderr)
    return 1 if found else 0


def _embed(model: str) -> int:
    files, queries = load_files(), load_queries()
    cache = VectorCache(model)
    wanted = [(embedding_input(f.name, f.summary, f.tags), "document") for f in files]
    wanted += [(q.text, "query") for q in queries]
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
    try:
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
    except NotImplementedError as error:
        print(f"Not written yet — {error}", file=sys.stderr)
        return 3

    print(f"{model}, limit {limit}, min similarity {min_similarity}")
    print(f"{'':6}{'queries':>8}{'recall@5':>10}{'MRR':>8}{'nDCG@10':>9}{'empty':>7}")
    everything = [row for lang in LANGUAGES for row in rows[lang]]
    for label, group in [*((g, rows[g]) for g in groups), ("all", everything)]:
        if group:
            recall, rr, ndcg = (statistics.fmean(row[i] for row in group) for i in range(3))
            empty = sum(row[3] for row in group)
            print(f"{label:6}{len(group):>8}{recall:>10.3f}{rr:>8.3f}{ndcg:>9.3f}{empty:>7}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="search-evals", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="find what is wrong with data/")
    for name, text in (("embed", "fetch the vectors cache/ is missing"), ("score", "measure with cached vectors")):
        command = commands.add_parser(name, help=text)
        command.add_argument("--model", default=EMBEDDING_MODEL)
        if name == "score":
            command.add_argument("--limit", type=int, default=SEARCH_RESULTS)
            command.add_argument("--min-similarity", type=float, default=SEARCH_MIN_SIMILARITY)
    args = parser.parse_args(argv)
    if args.command == "check":
        return _check()
    if args.command == "embed":
        return _embed(args.model)
    return _score(args.model, args.limit, args.min_similarity)


if __name__ == "__main__":
    sys.exit(main())
