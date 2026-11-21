"""The specification of chunks.py. Each expected cut was worked out by hand."""

from __future__ import annotations

import pytest

from search_evals.chunks import chunk, contains, units

THREE = "First paragraph.\n\nSecond one here.\n\nThird."


def texts(text: str, size: int, overlap: int = 0) -> list[str]:
    return [c.text for c in chunk(text, size, overlap)]


def test_short_text_is_one_piece() -> None:
    assert texts(THREE, 100) == [THREE]


def test_whole_paragraphs_go_together_while_they_fit() -> None:
    # 16 + 2 + 16 = 34 fits in 34; the third does not.
    assert texts(THREE, 34) == ["First paragraph.\n\nSecond one here.", "Third."]


def test_each_piece_is_a_slice_of_the_text_as_written() -> None:
    text = "  Lead.\n\n\n  Indented line\nwith a break.\n \nEnd.  "
    for piece in chunk(text, 20, 0):
        assert text[piece.start : piece.end] == piece.text
        assert piece.text == piece.text.strip()


def test_a_long_paragraph_splits_into_sentences() -> None:
    text = "One two three. Four five six! Seven eight nine?"
    assert texts(text, 20) == ["One two three.", "Four five six!", "Seven eight nine?"]


def test_a_long_sentence_splits_into_runs_of_words() -> None:
    assert texts("alpha beta gamma delta epsilon", 11) == ["alpha beta", "gamma delta", "epsilon"]


def test_a_word_longer_than_the_size_is_cut() -> None:
    assert texts("abcdefghij", 4) == ["abcd", "efgh", "ij"]


def test_nothing_is_dropped() -> None:
    text = "Π" * 30 + " end.\n\nMore text, in a second paragraph that is fairly long.\n\nLast."
    covered = set()
    for piece in chunk(text, 25, 0):
        covered.update(range(piece.start, piece.end))
    assert all(i in covered for i, ch in enumerate(text) if not ch.isspace())


def test_overlap_repeats_the_last_units_that_fit_in_it() -> None:
    text = "Aa.\n\nBb.\n\nCc.\n\nDd."
    # Units of 3; a piece of 8 holds two. With 3 of overlap the next piece
    # starts with the last unit of the one before.
    assert texts(text, 8, 3) == ["Aa.\n\nBb.", "Bb.\n\nCc.", "Cc.\n\nDd."]


def test_overlap_never_holds_a_piece_in_place() -> None:
    text = "Aa.\n\nBb.\n\nCc."
    # A piece of 3 holds one unit; going back would repeat it forever.
    assert texts(text, 3, 2) == ["Aa.", "Bb.", "Cc."]


def test_overlap_leaves_room_for_something_new() -> None:
    text = "Aa.\n\nBb.\n\nCccccccc."
    # "Bb." fits in the overlap of 8, but with it the next piece would be
    # 3 + 2 + 9 = 14, over the size of 10: it is not repeated.
    assert texts(text, 10, 8) == ["Aa.\n\nBb.", "Cccccccc."]


def test_overlap_repeats_a_unit_when_both_fit() -> None:
    text = "Aa.\n\nBbbbbbbb.\n\nCc."
    assert texts(text, 14, 10) == ["Aa.\n\nBbbbbbbb.", "Bbbbbbbb.\n\nCc."]


def test_windows_line_endings_are_read_as_paragraph_breaks() -> None:
    assert texts("One.\r\n\r\nTwo.", 5) == ["One.", "Two."]


def test_empty_text_has_no_pieces() -> None:
    assert chunk(" \n\n ", 10, 0) == []


def test_indexes_count_from_zero() -> None:
    assert [c.index for c in chunk(THREE, 20, 0)] == [0, 1, 2]


@pytest.mark.parametrize(("size", "overlap"), [(0, 0), (10, 10), (10, -1)])
def test_sizes_that_make_no_sense_are_refused(size: int, overlap: int) -> None:
    with pytest.raises(ValueError):
        chunk("text", size, overlap)


def test_units_keep_a_short_paragraph_whole() -> None:
    assert units("Short one. Two sentences.\n\nNext.", 100) == [(0, 25), (27, 32)]


def test_a_quote_is_found_across_a_different_line_break() -> None:
    assert contains("The rent is 950\neuros a month.", "rent is 950 euros")
    assert not contains("The rent is 950 euros", "rent is 960 euros")
