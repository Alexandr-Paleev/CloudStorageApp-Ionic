"""How a file's text is cut into the pieces a question is answered from.

Search by meaning stores one sentence per file, which says what a file is
about. A question about what a file says needs the text itself: "until when
does my lease run" is answered by a clause, not by "a lease for a flat in
Valencia". So the text is cut into pieces of at most `size` characters, each
piece is embedded, and a question is answered from the pieces nearest to it.

This is the specification of that cut. The app will do the same in
TypeScript, and `tests/test_chunks.py` is what the two are held to.

The rules, in order:

1. A paragraph (text between blank lines) is the unit. A piece is as many
   whole paragraphs as fit.
2. A paragraph longer than `size` is split into sentences, and a sentence
   longer than `size` into runs of words; a single word longer than `size`
   is cut at `size`. Nothing is dropped.
3. Each piece after the first starts with the last units of the one before,
   up to `overlap` characters of them. Units are repeated whole or not at
   all: a fact that runs from one unit into the next is whole in the next
   piece when the unit before the border fits in the overlap, and split
   when it does not. `split` in retrieval.py counts the quotes this cuts.
4. A piece is a slice of the original text, from the start of its first unit
   to the end of its last, so that whatever it says can be found in the file
   exactly as it is written there.

Characters rather than tokens: the size has to mean the same in Python and in
TypeScript without either loading a tokenizer, and the models this runs on
count Cyrillic and Latin text differently anyway.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A blank line, possibly with spaces on it, ends a paragraph.
_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n")
# A sentence ends at . ! ? or … followed by space. Abbreviations split too
# early sometimes; that costs a slightly smaller unit, never lost text.
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
_WORD = re.compile(r"\S+")


@dataclass(frozen=True)
class Chunk:
    index: int
    start: int
    end: int
    text: str


def _trimmed(text: str, start: int, end: int) -> tuple[int, int] | None:
    """The span without its leading and trailing whitespace, or None if empty."""
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _pieces(text: str, start: int, end: int, pattern: re.Pattern[str]) -> list[tuple[int, int]]:
    """The spans between matches of `pattern` inside text[start:end], trimmed."""
    spans: list[tuple[int, int]] = []
    cursor = start
    for match in pattern.finditer(text, start, end):
        span = _trimmed(text, cursor, match.start())
        if span:
            spans.append(span)
        cursor = match.end()
    span = _trimmed(text, cursor, end)
    if span:
        spans.append(span)
    return spans


def _words(text: str, start: int, end: int, size: int) -> list[tuple[int, int]]:
    """Runs of whole words, each at most `size` long; a longer word is cut."""
    runs: list[tuple[int, int]] = []
    run: tuple[int, int] | None = None
    for match in _WORD.finditer(text, start, end):
        w_start, w_end = match.span()
        while w_end - w_start > size:
            if run:
                runs.append(run)
                run = None
            runs.append((w_start, w_start + size))
            w_start += size
        if run and w_end - run[0] <= size:
            run = (run[0], w_end)
        else:
            if run:
                runs.append(run)
            run = (w_start, w_end)
    if run:
        runs.append(run)
    return runs


def units(text: str, size: int) -> list[tuple[int, int]]:
    """The spans a piece is built from: paragraphs, or what a long one splits into."""
    out: list[tuple[int, int]] = []
    for p_start, p_end in _pieces(text, 0, len(text), _PARAGRAPH_BREAK):
        if p_end - p_start <= size:
            out.append((p_start, p_end))
            continue
        for s_start, s_end in _pieces(text, p_start, p_end, _SENTENCE_END):
            if s_end - s_start <= size:
                out.append((s_start, s_end))
            else:
                out.extend(_words(text, s_start, s_end, size))
    return out


def chunk(text: str, size: int, overlap: int) -> list[Chunk]:
    """The pieces of `text`, each at most `size` characters, in order."""
    if size < 1:
        raise ValueError("size must be at least 1")
    if not 0 <= overlap < size:
        raise ValueError("overlap must be at least 0 and smaller than size")
    text = text.replace("\r\n", "\n")
    spans = units(text, size)
    chunks: list[Chunk] = []
    first = 0
    while first < len(spans):
        last = first
        while last + 1 < len(spans) and spans[last + 1][1] - spans[first][0] <= size:
            last += 1
        start, end = spans[first][0], spans[last][1]
        chunks.append(Chunk(index=len(chunks), start=start, end=end, text=text[start:end]))
        if last + 1 >= len(spans):
            break
        # The next piece goes back over the last units of this one, as many as
        # fit in `overlap` and leave room for at least one new unit; it always
        # moves forward by at least one unit.
        following = last + 1
        while (
            following - 1 > first
            and spans[last][1] - spans[following - 1][0] <= overlap
            and spans[last + 1][1] - spans[following - 1][0] <= size
        ):
            following -= 1
        first = following
    return chunks


def _squeezed(text: str) -> str:
    return " ".join(text.split())


def contains(piece: str, quote: str) -> bool:
    """Whether a piece holds the whole quote, whatever the line breaks in either."""
    return _squeezed(quote) in _squeezed(piece)
