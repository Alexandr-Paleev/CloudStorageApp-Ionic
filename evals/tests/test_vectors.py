from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from search_evals.vectors import VectorCache, key, slug


def test_a_saved_cache_reads_back_the_same(tmp_path: Path) -> None:
    cache = VectorCache("voyage-4", root=tmp_path)
    cache.put("hello", "query", [0.5, -0.25])
    cache.save()

    again = VectorCache("voyage-4", root=tmp_path)
    assert len(again) == 1
    np.testing.assert_array_equal(again.get("hello", "query"), np.array([0.5, -0.25], dtype=np.float32))


def test_the_same_words_on_the_two_sides_are_two_vectors(tmp_path: Path) -> None:
    cache = VectorCache("voyage-4", root=tmp_path)
    cache.put("invoice", "document", [1.0])
    assert cache.get("invoice", "query") is None
    assert key("invoice", "document") != key("invoice", "query")


def test_missing_names_each_pair_once(tmp_path: Path) -> None:
    cache = VectorCache("voyage-4", root=tmp_path)
    cache.put("a", "document", [1.0])
    assert cache.missing([("a", "document"), ("b", "query"), ("b", "query"), ("a", "query")]) == [
        ("b", "query"),
        ("a", "query"),
    ]


def test_a_side_that_does_not_exist_is_refused() -> None:
    with pytest.raises(ValueError):
        key("a", "passage")


def test_a_model_name_becomes_a_file_name() -> None:
    assert slug("@cf/baai/bge-large-en-v1.5") == "cf-baai-bge-large-en-v1-5"
    assert slug("voyage-4") == "voyage-4"
