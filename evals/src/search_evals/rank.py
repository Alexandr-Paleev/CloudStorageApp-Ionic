"""What `match_files` returns, in Python.

The function in migrations/011_add_file_embeddings.sql, which the browser
calls through `supabase.rpc('match_files', …)`:

    similarity = 1 - (embedding <=> query)     -- <=> is cosine distance
    WHERE (embedding <=> query) <= 1 - min_similarity
    ORDER BY (embedding <=> query)
    LIMIT LEAST(GREATEST(match_count, 1), 50)

`tests/test_rank.py` is the specification.

One deliberate difference: the SQL leaves the order of two equally close
files to the planner, and an eval whose ranking can change from run to run
cannot be compared with its last run. Ties are broken by id, ascending.

The vectors arrive as one row each in `documents`.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

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
    # One product per row, divided by both lengths: cosine, whatever the lengths.
    similarities = (documents @ query) / (np.linalg.norm(documents, axis=1) * np.linalg.norm(query))
    # >=, as the SQL's `distance <= 1 - min_similarity`: a file exactly at the floor stays.
    kept = [(file_id, float(s)) for file_id, s in zip(ids, similarities, strict=True) if s >= min_similarity]
    kept.sort(key=lambda pair: (-pair[1], pair[0]))
    return kept[: max(1, min(limit, 50))]
