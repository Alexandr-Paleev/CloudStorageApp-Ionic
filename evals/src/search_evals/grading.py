"""How an answer is graded, without asking another model.

Every measure here is a rule a reader can check by hand, so a score moves only
when an answer does, never because a judge read it differently the second
time:

- **facts**: what a correct answer must say, written per question in
  `data/questions.jsonl` as alternatives ("31 января 2027" or "31.01.2027").
  An alternative is matched as whole words; one ending in `*` is a stem
  ("отоплен*" for отопление, отопления). Numbers are compared written one way
  (`normalize`): "1,900", "1.900" and "1 900" are all 1900, "86,40" is 86.40.
- **refused**: the answer says one of the sentences the instruction gives for
  "not in your files" (`contract.REFUSALS`).
- **citations**: the `[n]` it gives, and whether the pieces they point at hold
  the question's evidence.
- **numbers not in the excerpts**: a number the answer states that neither the
  excerpts it was given nor the question contain. A rough measure of making
  things up, and a cheap one: invented amounts and dates are the harm here.
- **language**: whether the answer is in the question's, told from its script
  and its common words; "cannot tell" for an answer that is a code or a name.

`tests/test_grading.py` is the specification.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from .chunks import contains
from .contract import REFUSALS

# A citation as the instruction asks for it and as the screen links it: [2].
# "[1, 2]" is not one: src/pages/Ask.tsx shows it as text, so the reader
# could not open either piece, and the grading counts what the reader gets.
_CITATION = re.compile(r"\[(\d+)\]")


def normalize(text: str) -> str:
    """Lower case, one kind of apostrophe and space, ё as е, and numbers written one way."""
    text = unicodedata.normalize("NFC", text).casefold().replace("ё", "е")
    text = re.sub(r"[\u2018\u2019\u02bc]", "'", text)  # ‘ ’ ʼ
    text = re.sub(r"[\u00a0\u202f\u2009]", " ", text)  # no-break, narrow and thin spaces
    # A thousands separator: between digits, before exactly three of them.
    text = re.sub(r"(?<=\d)[ .,](?=\d{3}(?!\d))", "", text)
    # What is left between digits after a comma is a decimal part.
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    return re.sub(r"\s+", " ", text).strip()


def _pattern(alternative: str) -> re.Pattern[str]:
    stem = alternative.endswith("*")
    core = normalize(alternative[:-1] if stem else alternative)
    return re.compile(r"(?<!\w)" + re.escape(core) + ("" if stem else r"(?!\w)"))


def says(answer: str, alternatives: Sequence[str]) -> bool:
    """Whether the answer says one of the ways of stating a fact."""
    text = normalize(answer)
    return any(_pattern(alternative).search(text) for alternative in alternatives)


def refused(answer: str) -> bool:
    text = normalize(answer)
    return any(normalize(refusal).rstrip(".") in text for refusal in REFUSALS)


def citations(answer: str) -> list[int]:
    """The numbers the answer cites, each once, in the order first cited."""
    out: list[int] = []
    for number in _CITATION.findall(answer):
        if int(number) not in out:
            out.append(int(number))
    return out


def _canonical(token: str) -> str:
    parts = token.split(".")
    if len(parts) == 1:
        return str(int(token))
    if len(parts) == 2:
        whole, fraction = str(int(parts[0])), parts[1].rstrip("0")
        return f"{whole}.{fraction}" if fraction else whole
    return token


def numbers(text: str) -> set[str]:
    """The numbers a text states, each written one way, citations left out."""
    return {_canonical(token) for token in re.findall(r"\d+(?:\.\d+)*", normalize(_CITATION.sub(" ", text)))}


def numbers_not_in(answer: str, sources: Sequence[str]) -> list[str]:
    """Numbers in the answer that none of `sources` states, in sorted order.

    A number written with points ("31.01.2027") counts as stated when each of
    its parts is.
    """
    stated: set[str] = set()
    for source in sources:
        stated |= numbers(source)
    parts = {part for number in stated for part in number.split(".")}
    return sorted(
        number
        for number in numbers(answer)
        if number not in stated and not ("." in number and all(_canonical(p) in parts for p in number.split(".")))
    )


_ENGLISH = frozenset(
    "the is are was were your you of to and on at for it by with from each per this that not don't files say in".split()
)
_SPANISH = frozenset(
    "el la los las de del es en y que por para con su sus un una al lo se cada hasta archivos dicen está son fue".split()
)


def answer_language(answer: str) -> str | None:
    """en, es or ru; None when the answer gives nothing to tell by, such as a bare code."""
    text = _CITATION.sub(" ", answer)
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return None
    cyrillic = sum("CYRILLIC" in unicodedata.name(char, "") for char in letters)
    if cyrillic / len(letters) > 0.5:
        return "ru"
    words = re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", normalize(text))
    english = sum(word in _ENGLISH for word in words)
    spanish = sum(word in _SPANISH for word in words)
    if english == spanish == 0:
        return None
    return "es" if spanish > english else "en"


@dataclass(frozen=True)
class Grade:
    refused: bool
    # Answerable: every fact said and no refusal. Not answerable: a refusal.
    correct: bool
    facts_said: int
    facts: int
    cited: tuple[int, ...]
    # Cited numbers with no excerpt behind them, such as [9] of eight.
    citations_out_of_range: int
    # The share of the evidence quotes a cited piece holds; None where nothing
    # was to be cited (a refusal, or a question with no answer).
    evidence_cited: float | None
    # The share of cited pieces that hold any evidence quote; None with no citation.
    citation_precision: float | None
    numbers_not_in_excerpts: tuple[str, ...]
    language: str | None


def grade(
    answer: str,
    question: str,
    facts: Sequence[Sequence[str]],
    quotes: Sequence[str],
    excerpts: Sequence[str],
) -> Grade:
    """Grade one answer. `excerpts` are the pieces it was given, [1] first."""
    did_refuse = refused(answer)
    said = sum(says(answer, alternatives) for alternatives in facts)
    answerable = bool(quotes)
    cited = citations(answer)
    pointed = [excerpts[n - 1] for n in cited if 1 <= n <= len(excerpts)]

    evidence_cited = None
    if answerable and not did_refuse:
        evidence_cited = sum(any(contains(piece, quote) for piece in pointed) for quote in quotes) / len(quotes)
    citation_precision = None
    if answerable and cited:
        citation_precision = sum(any(contains(piece, quote) for quote in quotes) for piece in pointed) / len(cited)

    return Grade(
        refused=did_refuse,
        correct=(said == len(facts) and not did_refuse) if answerable else did_refuse,
        facts_said=said,
        facts=len(facts),
        cited=tuple(cited),
        citations_out_of_range=len(cited) - len(pointed),
        evidence_cited=evidence_cited,
        citation_precision=citation_precision,
        numbers_not_in_excerpts=tuple(numbers_not_in(answer, [*excerpts, question])),
        language=answer_language(answer),
    )
