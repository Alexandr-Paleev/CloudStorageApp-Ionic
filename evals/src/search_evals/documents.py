"""The files a question is answered from, and the questions.

`data/corpus.jsonl` holds what the search index stores for a file: a name and
one sentence. Answering a question needs the text, so this is a second set:
`data/documents/<id>.txt` is a file's text as the app would read it, and
`data/documents.jsonl` its name and language.

A question in `data/questions.jsonl` says where its answer is written, as
`evidence`: quotes, each copied exactly from one document. That is what makes
the labels independent of how the text is cut. A piece "answers" when it holds
a whole quote, whatever size the pieces are, so the same labels score every
size. A question with no evidence has no answer in these files; it is there to
see whether the answer says so (`answer` is null for it).

A reference answer says nothing its quotes do not: the answers' eval holds a
model's answer to the quotes, and a reference that knew more would mark a
faithful answer as missing something. A quote counts wherever it is found,
and one is in two files on purpose: both bills give the same number for a
power cut.

The documents and everyone in them are made up. Pairs of them are alike on
purpose, as a person's files are: two electricity bills a month apart, two
insurance policies, two trips. A question about one should not be answered
from the other.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .chunks import contains
from .data import DATA, LANGUAGES, _lines


@dataclass(frozen=True)
class Document:
    id: str
    name: str
    lang: str
    text: str


@dataclass(frozen=True)
class Evidence:
    doc: str
    quote: str


@dataclass(frozen=True)
class Question:
    id: str
    text: str
    lang: str
    evidence: tuple[Evidence, ...]
    answer: str | None

    @property
    def answerable(self) -> bool:
        return bool(self.evidence)


def load_documents(root: Path = DATA) -> list[Document]:
    return [
        Document(
            id=row["id"],
            name=row["name"],
            lang=row["lang"],
            text=(root / "documents" / f"{row['id']}.txt").read_text(encoding="utf-8"),
        )
        for row in _lines(root / "documents.jsonl")
    ]


def load_questions(path: Path = DATA / "questions.jsonl") -> list[Question]:
    return [
        Question(
            id=row["id"],
            text=row["text"],
            lang=row["lang"],
            evidence=tuple(Evidence(doc=e["doc"], quote=e["quote"]) for e in row["evidence"]),
            answer=row["answer"],
        )
        for row in _lines(path)
    ]


def across_languages(question: Question, documents: dict[str, Document]) -> bool:
    """Whether the answer is written in a language other than the question's."""
    return any(documents[e.doc].lang != question.lang for e in question.evidence)


def problems(documents: list[Document], questions: list[Question]) -> list[str]:
    """Everything wrong with the data, as sentences; an empty list when nothing is."""
    found: list[str] = []
    for kind, ids in (("document", [d.id for d in documents]), ("question", [q.id for q in questions])):
        for duplicate in sorted({i for i in ids if ids.count(i) > 1}):
            found.append(f"{kind} id {duplicate} is used more than once")

    by_id = {d.id: d for d in documents}
    for d in documents:
        if d.lang not in LANGUAGES:
            found.append(f"document {d.id}: language {d.lang!r} is not one of {LANGUAGES}")
        if not d.text.strip():
            found.append(f"document {d.id}: the text is empty")

    for q in questions:
        if q.lang not in LANGUAGES:
            found.append(f"question {q.id}: language {q.lang!r} is not one of {LANGUAGES}")
        if q.answerable != (q.answer is not None):
            found.append(f"question {q.id}: evidence and a reference answer go together, or neither")
        for e in q.evidence:
            document = by_id.get(e.doc)
            if document is None:
                found.append(f"question {q.id}: document {e.doc} does not exist")
            elif not contains(document.text, e.quote):
                found.append(f"question {q.id}: {e.doc} does not say {e.quote!r}")
    return found

