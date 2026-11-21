"""The specification of retrieval.py. Each case was worked out by hand."""

from __future__ import annotations

import pytest

from search_evals.documents import Document
from search_evals.retrieval import Piece, overlap_for, piece_input, pieces, recall, reciprocal_rank, split

RANKED = ["The rent is 950 euros.", "Paid by the 5th.", "Deposit: 1900 euros."]


def test_recall_counts_the_quotes_found_in_the_first_k() -> None:
    assert recall(RANKED, ["rent is 950"], 1) == 1.0
    assert recall(RANKED, ["rent is 950", "Deposit: 1900"], 2) == 0.5
    assert recall(RANKED, ["rent is 950", "Deposit: 1900"], 3) == 1.0


def test_recall_finds_a_quote_across_a_line_break() -> None:
    assert recall(["The rent is\n950 euros."], ["rent is 950"], 1) == 1.0


def test_a_quote_cut_by_a_border_is_not_found() -> None:
    assert recall(["The rent is", "950 euros."], ["rent is 950"], 2) == 0.0


def test_reciprocal_rank_is_one_over_the_first_position_holding_any_quote() -> None:
    assert reciprocal_rank(RANKED, ["Deposit: 1900", "by the 5th"]) == 0.5
    assert reciprocal_rank(RANKED, ["not there"]) == 0.0


def test_a_question_without_evidence_is_not_scored() -> None:
    with pytest.raises(ValueError):
        recall(RANKED, [], 3)
    with pytest.raises(ValueError):
        reciprocal_rank(RANKED, [])


def test_split_counts_the_quotes_no_piece_holds() -> None:
    cut = [Piece("d#0", "d", "The rent is", ""), Piece("d#1", "d", "950 euros.", "")]
    assert split(cut, ["rent is 950", "950 euros"]) == 1


def test_pieces_are_named_after_their_document_and_embedded_with_its_name() -> None:
    document = Document(id="d01", name="lease.pdf", lang="en", text="One.\n\nTwo.")
    assert [(p.id, p.text, p.input) for p in pieces([document], 5)] == [
        ("d01#000", "One.", "lease.pdf\nOne."),
        ("d01#001", "Two.", "lease.pdf\nTwo."),
    ]


def test_the_overlap_is_a_share_of_the_size() -> None:
    assert overlap_for(800) == 120


def test_piece_input_puts_the_name_first() -> None:
    assert piece_input("bill.pdf", "86,40 euros") == "bill.pdf\n86,40 euros"
