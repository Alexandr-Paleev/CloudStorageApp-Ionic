"""What `match_files` returns, in Python. Yours to write.

The function in migrations/011_add_file_embeddings.sql, which the browser
calls through `supabase.rpc('match_files', …)`:

    similarity = 1 - (embedding <=> query)     -- <=> is cosine distance
    WHERE (embedding <=> query) <= 1 - min_similarity
    ORDER BY (embedding <=> query)
    LIMIT LEAST(GREATEST(match_count, 1), 50)

`tests/test_rank.py` is the specification.

One deliberate difference: the SQL leaves the order of two equally close
files to the planner, and an eval whose ranking can change from run to run
cannot be compared with its last run. Break ties by id, ascending.

numpy is there for this: the vectors arrive as one row each in `documents`.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

YOURS = "yours to write: see the docstring and tests/test_rank.py"


def rank(
    query: np.ndarray,
    documents: np.ndarray,
    ids: Sequence[str],
    *,
    limit: int,
    min_similarity: float,
) -> list[tuple[str, float]]:
    """(file id, cosine similarity) pairs, the most similar first.

    `documents[i]` is the vector of `ids[i]`. Vectors are not assumed to be
    normalised. At most `limit` pairs, with `limit` clamped to 1..50 as the
    SQL clamps it, and none whose similarity is below `min_similarity`.
    """
    raise NotImplementedError(YOURS)
