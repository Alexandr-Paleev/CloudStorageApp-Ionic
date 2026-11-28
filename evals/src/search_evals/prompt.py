"""The message a model is asked to answer from: `excerptsAsText`,
`questionLanguage` and `distinctPieces` in libs/server/src/answer.ts, in Python.

The instruction itself is not copied: it is read from the contract
(`contract.ANSWER_SYSTEM`), which the app's test holds word for word. These two
functions are copies, and the contract's cases hold them to the app's output
(`tests/test_contract.py`).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TypeVar

OPEN = "<excerpts>"
CLOSE = "</excerpts>"

# Words a Spanish question is all but certain to hold one of: SPANISH_WORDS in answer.ts.
SPANISH_WORDS = frozenset(
    "qué que cuánto cuanto cuánta cuanta cuándo cuando dónde donde cómo como cuál cual "
    "quién quien mi mis el la los las de del en es un una por para tengo hay mío mía".split()
)


@dataclass(frozen=True)
class Excerpt:
    n: int
    file_name: str
    content: str


T = TypeVar("T")


def distinct_pieces(pieces: Sequence[T], limit: int, text: Callable[[T], str]) -> list[T]:
    """The pieces in the order given, nearest first, with every text already kept
    dropped, the first `limit`: `distinctPieces` in answer.ts. A copy of a file
    gives the same pieces twice; the nearer one stays."""
    seen: set[str] = set()
    kept: list[T] = []
    for piece in pieces:
        if len(kept) >= limit:
            break
        key = text(piece).strip()
        if key in seen:
            continue
        seen.add(key)
        kept.append(piece)
    return kept


def _fenced(text: str) -> str:
    return text.replace(OPEN, "").replace(CLOSE, "")


def _latin_only(text: str) -> bool:
    """`/^[\\p{Script=Latin}\\p{N}\\p{P}\\p{S}\\s]+$/u`: Python's re has no scripts."""
    if not text:
        return False
    for char in text:
        category = unicodedata.category(char)
        if char.isspace() or category[0] in "NPS":
            continue
        if category[0] == "L" and unicodedata.name(char, "").startswith("LATIN"):
            continue
        return False
    return True


def question_language(question: str) -> str | None:
    """English, Spanish or Russian, or None for another language."""
    if re.search(r"[а-яё]", question, re.IGNORECASE):
        return "Russian"
    if re.search(r"[¿¡ñ]", question, re.IGNORECASE):
        return "Spanish"
    words = re.findall(r"[^\W\d_]+", question.lower())
    if any(word in SPANISH_WORDS for word in words):
        return "Spanish"
    if re.search(r"[áéíóúü]", question, re.IGNORECASE):
        return "Spanish"
    return "English" if _latin_only(question) else None


def excerpts_as_text(excerpts: list[Excerpt], question: str) -> str:
    blocks = [f"[{e.n}] {_fenced(e.file_name)}\n{_fenced(e.content)}" for e in excerpts]
    language = question_language(question)
    closing = f"Answer in {language}." if language else "Answer in the language of the question."
    return f"{OPEN}\n" + "\n\n".join(blocks) + f"\n{CLOSE}\n\nQuestion: {question}\n\n" + closing
