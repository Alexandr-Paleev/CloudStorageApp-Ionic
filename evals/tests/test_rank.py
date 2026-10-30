"""The specification of rank.py: match_files, as migrations/011 writes it."""

from __future__ import annotations

import math

import numpy as np
import pytest

from search_evals.rank import rank

DOCS = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]])
IDS = ["a", "b", "c"]
EAST = np.array([1.0, 0.0])


def pairs(result: list[tuple[str, float]]) -> list[tuple[str, float]]:
    return [(file_id, round(float(similarity), 4)) for file_id, similarity in result]


def test_most_similar_first(yours) -> None:
    result = yours(rank, EAST, DOCS, IDS, limit=15, min_similarity=0.0)
    assert pairs(result) == [("a", 1.0), ("c", round(1 / math.sqrt(2), 4)), ("b", 0.0)]


def test_nothing_below_the_floor(yours) -> None:
    assert pairs(yours(rank, EAST, DOCS, IDS, limit=15, min_similarity=0.75)) == [("a", 1.0)]


def test_a_vector_pointing_away_is_below_a_floor_of_zero(yours) -> None:
    docs = np.array([[1.0, 0.0], [-1.0, 0.0]])
    assert pairs(yours(rank, EAST, docs, ["near", "away"], limit=15, min_similarity=0.0)) == [("near", 1.0)]
    assert pairs(yours(rank, EAST, docs, ["near", "away"], limit=15, min_similarity=-1.0)) == [
        ("near", 1.0),
        ("away", -1.0),
    ]


def test_length_does_not_matter_only_direction(yours) -> None:
    docs = np.array([[2.0, 0.0], [0.0, 3.0]])
    assert pairs(yours(rank, np.array([5.0, 0.0]), docs, ["x", "y"], limit=15, min_similarity=0.0)) == [
        ("x", 1.0),
        ("y", 0.0),
    ]


def test_equally_similar_files_come_in_the_order_of_their_ids(yours) -> None:
    docs = np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 1.0]])
    result = yours(rank, EAST, docs, ["z", "m", "a"], limit=15, min_similarity=0.0)
    assert [file_id for file_id, _ in result] == ["m", "z", "a"]


@pytest.mark.parametrize(("limit", "expected"), [(1, 1), (0, 1), (-5, 1), (100, 50)])
def test_the_limit_is_clamped_as_the_sql_clamps_it(yours, limit: int, expected: int) -> None:
    rng = np.random.default_rng(0)
    docs = rng.normal(size=(60, 8))
    ids = [f"f{i:02}" for i in range(60)]
    query = docs[0]
    assert len(yours(rank, query, docs, ids, limit=limit, min_similarity=-1.0)) == expected
