from __future__ import annotations

import pytest

from search_evals.contract import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_INPUT_CASES,
    EMBEDDING_MODEL,
    SEARCH_MIN_SIMILARITY,
    SEARCH_RESULTS,
    embedding_input,
)


@pytest.mark.parametrize("case", EMBEDDING_INPUT_CASES, ids=lambda case: case["name"].strip())
def test_a_file_is_embedded_as_the_app_embeds_it(case: dict) -> None:
    # The same cases libs/core/src/ai.test.ts runs against embeddingInput.
    assert embedding_input(case["name"], case["summary"], case["tags"]) == case["expected"]


def test_the_contract_is_read_rather_than_copied() -> None:
    assert (EMBEDDING_MODEL, EMBEDDING_DIMENSIONS) == ("voyage-4", 1024)
    assert SEARCH_RESULTS == 15
    assert 0 < SEARCH_MIN_SIMILARITY < 1
