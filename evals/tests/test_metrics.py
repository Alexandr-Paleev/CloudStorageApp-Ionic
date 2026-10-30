"""The specification of metrics.py. Every expected value was worked out by hand."""

from __future__ import annotations

import math

import pytest

from search_evals.metrics import ndcg_at_k, recall_at_k, reciprocal_rank

ONE_A_ONE_C = {"a": 1, "c": 2}


@pytest.mark.parametrize(("k", "expected"), [(1, 0.5), (2, 0.5), (3, 1.0), (10, 1.0)])
def test_recall_counts_the_relevant_files_in_the_first_k(yours, k: int, expected: float) -> None:
    assert yours(recall_at_k, ["a", "b", "c"], ONE_A_ONE_C, k) == pytest.approx(expected)


def test_recall_is_zero_when_nothing_relevant_came_back(yours) -> None:
    assert yours(recall_at_k, ["x", "y"], {"a": 3}, 5) == 0.0


def test_recall_counts_every_grade_alike(yours) -> None:
    assert yours(recall_at_k, ["b", "x"], {"a": 3, "b": 1}, 2) == pytest.approx(0.5)


def test_reciprocal_rank_is_one_over_the_first_relevant_position(yours) -> None:
    assert yours(reciprocal_rank, ["x", "a", "c"], {"a": 1}) == pytest.approx(0.5)
    assert yours(reciprocal_rank, ["a"], {"a": 1}) == pytest.approx(1.0)


def test_reciprocal_rank_takes_the_first_relevant_file_whatever_its_grade(yours) -> None:
    assert yours(reciprocal_rank, ["b", "a"], {"a": 3, "b": 1}) == pytest.approx(1.0)


def test_reciprocal_rank_is_zero_when_nothing_relevant_came_back(yours) -> None:
    assert yours(reciprocal_rank, ["x", "y"], {"a": 1}) == 0.0
    assert yours(reciprocal_rank, [], {"a": 1}) == 0.0


def test_ndcg_weighs_position_and_grade(yours) -> None:
    # a (grade 3) first, nothing second, c (grade 1) third.
    dcg = (2**3 - 1) / math.log2(2) + 0 + (2**1 - 1) / math.log2(4)  # 7 + 0.5
    ideal = (2**3 - 1) / math.log2(2) + (2**1 - 1) / math.log2(3)  # 7 + 0.631
    assert yours(ndcg_at_k, ["a", "b", "c"], {"a": 3, "c": 1}, 3) == pytest.approx(dcg / ideal)  # 0.983


def test_ndcg_punishes_the_better_file_coming_second(yours) -> None:
    dcg = (2**1 - 1) / math.log2(2) + (2**3 - 1) / math.log2(3)  # 1 + 4.417
    ideal = (2**3 - 1) / math.log2(2) + (2**1 - 1) / math.log2(3)  # 7 + 0.631
    assert yours(ndcg_at_k, ["c", "a"], {"a": 3, "c": 1}, 2) == pytest.approx(dcg / ideal)  # 0.710


def test_ndcg_cuts_the_ideal_at_k_too(yours) -> None:
    # Three files of grade 3 exist, but at k = 1 the best possible is one of them.
    assert yours(ndcg_at_k, ["a", "x"], {"a": 3, "b": 3, "c": 3}, 1) == pytest.approx(1.0)


def test_ndcg_is_zero_when_nothing_relevant_is_in_the_first_k(yours) -> None:
    assert yours(ndcg_at_k, ["x", "y", "a"], {"a": 3}, 2) == 0.0


def test_ndcg_of_the_perfect_ranking_is_one(yours) -> None:
    assert yours(ndcg_at_k, ["a", "c", "x"], {"a": 3, "c": 1}, 10) == pytest.approx(1.0)


@pytest.mark.parametrize(
    "call",
    [
        lambda: recall_at_k(["a"], {}, 5),
        lambda: reciprocal_rank(["a"], {}),
        lambda: ndcg_at_k(["a"], {}, 5),
    ],
    ids=["recall", "reciprocal rank", "ndcg"],
)
def test_a_query_with_nothing_relevant_is_an_error_not_a_zero(yours, call) -> None:
    with pytest.raises(ValueError):
        yours(call)
