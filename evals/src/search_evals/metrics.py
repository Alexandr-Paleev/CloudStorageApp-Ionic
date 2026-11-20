"""How good one ranking is, three ways.

Each function scores the answer to one query. `ranked` is file ids, best
first, as the search returned them. `relevant` maps each file that answers the
query to its grade: 3 is the file the person means, 2 one they would be glad to
see, 1 one that is related. A file not in `relevant` is not relevant.

`tests/test_metrics.py` is the specification: every case in it was worked out
by hand.

Things worth knowing before an interview asks:
- recall@k ignores order inside the first k; MRR looks only at the first hit;
  nDCG weighs every position and every grade. Each answers a different
  question, which is why the report shows all three.
- A query whose `relevant` is empty is an error in the data, not a score of 0:
  a zero would silently drag the mean down. Raise ValueError.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence


def recall_at_k(ranked: Sequence[str], relevant: Mapping[str, int], k: int) -> float:
    """The share of the relevant files that are among the first `k` results.

    Any grade counts as relevant here. With 4 relevant files and 3 of them in
    the first 5 results, recall@5 is 0.75.
    """
    _require_relevant(relevant)
    # A set, so that a file the search returned twice is counted once.
    found = set(ranked[:k]) & relevant.keys()
    return len(found) / len(relevant)


def reciprocal_rank(ranked: Sequence[str], relevant: Mapping[str, int]) -> float:
    """1 / the position of the first relevant result, counting from 1.

    0.0 when no relevant file was returned. MRR, in the report, is the mean of
    this over the queries.
    """
    _require_relevant(relevant)
    for position, file_id in enumerate(ranked, start=1):
        if file_id in relevant:
            return 1 / position
    return 0.0


def ndcg_at_k(ranked: Sequence[str], relevant: Mapping[str, int], k: int) -> float:
    """Discounted cumulative gain of the first `k` results, over the best possible.

    The gain of a result is 2**grade - 1, and 0 for a file that is not
    relevant. A result at position p (from 1) is discounted by log2(p + 1).
    The best possible ranking puts the relevant files first, highest grade
    first, and is cut at `k` the same way. 1.0 is a perfect first `k`, 0.0 is
    nothing relevant in it.
    """
    _require_relevant(relevant)
    found = _discounted_gain(relevant.get(file_id, 0) for file_id in ranked[:k])
    # Grades start at 1, so the best possible is above 0 once `relevant` is not empty.
    best = _discounted_gain(sorted(relevant.values(), reverse=True)[:k])
    return found / best


def _discounted_gain(grades: Iterable[int]) -> float:
    """The sum of 2**grade - 1 over log2(position + 1), the first grade at position 1."""
    return sum((2**grade - 1) / math.log2(position + 1) for position, grade in enumerate(grades, start=1))


def _require_relevant(relevant: Mapping[str, int]) -> None:
    if not relevant:
        raise ValueError("a query must have at least one relevant file; this one has none")
