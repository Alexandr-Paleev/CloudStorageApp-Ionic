"""Whether the pieces nearest to a question hold its answer, for each size of piece.

The answer to a question is given by a model that reads the first `k` pieces
the search returns, and nothing else. So the measurement is whether those `k`
pieces hold the evidence, and what reading them costs:

- recall@k: the share of a question's quotes that are whole in one of the
  first `k` pieces. A question with two quotes and one found scores 0.5.
- all@k: the share of questions whose every quote is there. This is the one
  a reader feels: half an answer is often a wrong one.
- MRR: one over the position of the first piece that holds any quote.
- context: the characters in the first `k` pieces, which the model is paid
  to read on every question.
- split: quotes no piece holds at all, because a border fell through them.
  Those cannot be found at that size whatever the ranking.

`tests/test_retrieval.py` is the specification.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .chunks import chunk, contains
from .documents import Document

# The sizes compared, in characters. 400 is about two short paragraphs;
# 1600 is about a page of a contract.
SIZES = (400, 800, 1200, 1600)
# Each piece repeats about this share of the one before it.
OVERLAP_SHARE = 0.15


def overlap_for(size: int) -> int:
    return int(size * OVERLAP_SHARE)


def piece_input(name: str, text: str) -> str:
    """The text a piece is embedded as: the file's name, then the piece.

    The name, because it is often the only place a piece's subject is said:
    "Importe total a pagar: 86,40 euros" does not say it is electricity, and
    "factura-luz-marzo-2026.pdf" does.
    """
    return f"{name}\n{text}"


@dataclass(frozen=True)
class Piece:
    id: str
    doc: str
    text: str
    input: str


def pieces(documents: Sequence[Document], size: int) -> list[Piece]:
    out: list[Piece] = []
    for document in documents:
        for c in chunk(document.text, size, overlap_for(size)):
            out.append(
                Piece(
                    id=f"{document.id}#{c.index:03d}",
                    doc=document.id,
                    text=c.text,
                    input=piece_input(document.name, c.text),
                )
            )
    return out


def recall(ranked: Sequence[str], quotes: Sequence[str], k: int) -> float:
    """The share of `quotes` that one of the first `k` pieces holds whole."""
    if not quotes:
        raise ValueError("a question with no evidence has nothing to find")
    first = ranked[:k]
    return sum(any(contains(text, quote) for text in first) for quote in quotes) / len(quotes)


def reciprocal_rank(ranked: Sequence[str], quotes: Sequence[str]) -> float:
    """One over the position of the first piece holding any quote; 0 if none does."""
    if not quotes:
        raise ValueError("a question with no evidence has nothing to find")
    for position, text in enumerate(ranked, start=1):
        if any(contains(text, quote) for quote in quotes):
            return 1 / position
    return 0.0


def split(all_pieces: Sequence[Piece], quotes: Sequence[str]) -> int:
    """How many of `quotes` no piece at all holds."""
    return sum(not any(contains(p.text, quote) for p in all_pieces) for quote in quotes)
