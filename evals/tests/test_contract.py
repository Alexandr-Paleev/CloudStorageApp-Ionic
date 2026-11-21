from __future__ import annotations

import pytest

from search_evals.chunks import chunk
from search_evals.contract import (
    CHUNK_CASES,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    PIECE_INPUT_CASES,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_INPUT_CASES,
    EMBEDDING_MODEL,
    SEARCH_FLOORS,
    SEARCH_MIN_SIMILARITY,
    SEARCH_RESULTS,
    embedding_input,
    search_floor,
)
from search_evals.retrieval import SIZES, overlap_for, piece_input


@pytest.mark.parametrize("case", EMBEDDING_INPUT_CASES, ids=lambda case: case["name"].strip())
def test_a_file_is_embedded_as_the_app_embeds_it(case: dict) -> None:
    # The same cases libs/core/src/ai.test.ts runs against embeddingInput.
    assert embedding_input(case["name"], case["summary"], case["tags"]) == case["expected"]


def test_the_contract_is_read_rather_than_copied() -> None:
    assert (EMBEDDING_MODEL, EMBEDDING_DIMENSIONS) == ("voyage-4", 1024)
    assert SEARCH_RESULTS == 15
    assert 0 < SEARCH_MIN_SIMILARITY < 1
    assert all(0 < floor < 1 for floor in SEARCH_FLOORS.values())


def test_each_measured_model_has_its_floor_and_the_rest_the_general_one() -> None:
    assert search_floor("voyage-4") == 0.25
    assert search_floor("@cf/baai/bge-m3") == 0.4
    assert search_floor("@cf/baai/bge-large-en-v1.5") == SEARCH_MIN_SIMILARITY


@pytest.mark.parametrize("case", CHUNK_CASES, ids=lambda case: case["name"])
def test_text_is_cut_as_the_app_cuts_it(case: dict) -> None:
    # The same cases libs/core/src/chunks.test.ts runs against chunkText.
    assert [c.text for c in chunk(case["text"], case["size"], case["overlap"])] == case["pieces"]


@pytest.mark.parametrize("case", PIECE_INPUT_CASES, ids=lambda case: case["name"])
def test_a_piece_is_embedded_as_the_app_embeds_it(case: dict) -> None:
    assert piece_input(case["name"], case["text"]) == case["expected"]


def test_the_app_cuts_at_the_size_the_eval_chose() -> None:
    # 400 won the comparison (ADR 0019); the overlap is the share the
    # comparison used, so the app runs what was measured.
    assert CHUNK_SIZE == 400
    assert CHUNK_SIZE in SIZES
    assert CHUNK_OVERLAP == overlap_for(CHUNK_SIZE)
