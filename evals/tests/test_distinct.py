"""A copy of a file, read once (docs/decisions/0019, "A copy of a file is read once").

On the cached bge-m3 vectors, the 2026 CV is copied under another name with the
same pieces and the same vectors, as a file uploaded twice is indexed. The
numbers asserted are the ones the decision states.
"""

from __future__ import annotations

import numpy as np

from search_evals.chunks import contains
from search_evals.contract import CHUNK_SIZE, EXCERPTS_PER_QUESTION, PIECES_SEARCHED
from search_evals.documents import load_documents, load_questions
from search_evals.prompt import distinct_pieces
from search_evals.rank import rank
from search_evals.retrieval import Piece, pieces
from search_evals.vectors import VectorCache

MODEL = "@cf/baai/bge-m3"


def _cv_questions_fully_read(copy: bool, drop_repeats: bool) -> int:
    cache = VectorCache(MODEL)
    found = pieces(load_documents(), CHUNK_SIZE)
    vectors = {p.id: cache.get(p.input, "document") for p in found}
    if copy:
        copies = [Piece(id=p.id.replace("d16", "d16copy"), doc="d16copy", text=p.text, input=p.input) for p in found if p.doc == "d16"]
        for c in copies:
            vectors[c.id] = vectors[c.id.replace("d16copy", "d16")]
        found = found + copies
    by_id = {p.id: p for p in found}
    ids = [p.id for p in found]
    matrix = np.stack([vectors[i] for i in ids])
    fully_read = 0
    for q in load_questions():
        if not (q.answerable and q.id.startswith("c")):
            continue
        nearest = [by_id[i] for i, _ in rank(cache.get(q.text, "query"), matrix, ids, limit=PIECES_SEARCHED, min_similarity=0.0)]
        read = distinct_pieces(nearest, EXCERPTS_PER_QUESTION, lambda p: p.text) if drop_repeats else nearest[:EXCERPTS_PER_QUESTION]
        fully_read += all(any(contains(p.text, e.quote) for p in read) for e in q.evidence)
    return fully_read


def test_with_no_copy_dropping_repeats_changes_nothing() -> None:
    assert _cv_questions_fully_read(copy=False, drop_repeats=False) == 6
    assert _cv_questions_fully_read(copy=False, drop_repeats=True) == 6


def test_a_copy_takes_places_unless_its_repeats_are_dropped() -> None:
    assert _cv_questions_fully_read(copy=True, drop_repeats=False) == 5
    assert _cv_questions_fully_read(copy=True, drop_repeats=True) == 6
