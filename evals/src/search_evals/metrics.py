"""How good one ranking is, three ways. Yours to write.

Each function scores the answer to one query. `ranked` is file ids, best
first, as the search returned them. `relevant` maps each file that answers the
query to its grade: 3 is the file the person means, 2 one they would be glad to
see, 1 one that is related. A file not in `relevant` is not relevant.

`tests/test_metrics.py` is the specification: every case in it was worked out
by hand. Until a function is written, its tests are skipped, not failed, and
`search-evals score` says which one is missing.

Things worth knowing before an interview asks:
- recall@k ignores order inside the first k; MRR looks only at the first hit;
  nDCG weighs every position and every grade. Each answers a different
  question, which is why the report shows all three.
- A query whose `relevant` is empty is an error in the data, not a score of 0:
  a zero would silently drag the mean down. Raise ValueError.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

YOURS = "yours to write: see the docstring and tests/test_metrics.py"


def recall_at_k(ranked: Sequence[str], relevant: Mapping[str, int], k: int) -> float:
    """The share of the relevant files that are among the first `k` results.

    Any grade counts as relevant here. With 4 relevant files and 3 of them in
    the first 5 results, recall@5 is 0.75.
    """
    raise NotImplementedError(YOURS)


def reciprocal_rank(ranked: Sequence[str], relevant: Mapping[str, int]) -> float:
    """1 / the position of the first relevant result, counting from 1.

    0.0 when no relevant file was returned. MRR, in the report, is the mean of
    this over the queries.
    """
    raise NotImplementedError(YOURS)


def ndcg_at_k(ranked: Sequence[str], relevant: Mapping[str, int], k: int) -> float:
    """Discounted cumulative gain of the first `k` results, over the best possible.

    The gain of a result is 2**grade - 1, and 0 for a file that is not
    relevant. A result at position p (from 1) is discounted by log2(p + 1).
    The best possible ranking puts the relevant files first, highest grade
    first, and is cut at `k` the same way. 1.0 is a perfect first `k`, 0.0 is
    nothing relevant in it.
    """
    raise NotImplementedError(YOURS)
