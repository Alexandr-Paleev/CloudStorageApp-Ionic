"""The files the eval searches, and the questions it asks about them.

A file is what the index stores for one upload: its name, the sentence a model
wrote about it, and the tags, in the language the model wrote them in. A query
is something a person might type, with the files that answer it and how well
each does: 3 is the file they mean, 2 a file they would be glad to see, 1 one
that is related. Every file a query does not list counts as not relevant.

Both live in `data/` as one JSON object per line, so that a new case is one
line in a diff and a reviewer can read what each label claims.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from .contract import MAX_SUMMARY_CHARS, MAX_TAG_CHARS, MAX_TAGS

DATA = Path(__file__).resolve().parents[2] / "data"
LANGUAGES = ("en", "es", "ru")
GRADES = (1, 2, 3)


@dataclass(frozen=True)
class File:
    id: str
    name: str
    lang: str
    summary: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class Query:
    id: str
    text: str
    lang: str
    relevant: Mapping[str, int]


def _lines(path: Path) -> Iterable[dict]:
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if line.strip():
            try:
                yield json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path.name}:{number}: {error}") from error


def load_files(path: Path = DATA / "corpus.jsonl") -> list[File]:
    return [
        File(id=row["id"], name=row["name"], lang=row["lang"], summary=row["summary"], tags=tuple(row["tags"]))
        for row in _lines(path)
    ]


def load_queries(path: Path = DATA / "queries.jsonl") -> list[Query]:
    return [
        Query(id=row["id"], text=row["text"], lang=row["lang"], relevant=dict(row["relevant"]))
        for row in _lines(path)
    ]


def only_across_languages(query: Query, files: Mapping[str, File]) -> bool:
    """Whether no file the query means (grade 3) is in the language it is asked in.

    Such a query can only be answered across languages, which is the case an
    English-only model is expected to fail. The report shows these apart from
    the rest, since a query's language alone does not say it: a Russian
    question about a Russian contract is not the same test as one about a
    picture, which the model describes in English.
    """
    return all(files[file_id].lang != query.lang for file_id, grade in query.relevant.items() if grade == 3)


def problems(files: list[File], queries: list[Query]) -> list[str]:
    """Everything wrong with the data, as sentences; an empty list when nothing is.

    The limits are the database's (migrations/011), read through the contract:
    a summary the table would refuse is not one the index could hold.
    """
    found: list[str] = []
    file_ids = [f.id for f in files]
    query_ids = [q.id for q in queries]
    for kind, ids in (("file", file_ids), ("query", query_ids)):
        for duplicate in sorted({i for i in ids if ids.count(i) > 1}):
            found.append(f"{kind} id {duplicate} is used more than once")

    for f in files:
        if f.lang not in LANGUAGES:
            found.append(f"file {f.id}: language {f.lang!r} is not one of {LANGUAGES}")
        if not 1 <= len(f.summary) <= MAX_SUMMARY_CHARS:
            found.append(f"file {f.id}: the summary is {len(f.summary)} characters")
        if len(f.tags) > MAX_TAGS:
            found.append(f"file {f.id}: {len(f.tags)} tags, the table holds {MAX_TAGS}")
        for tag in f.tags:
            if len(tag) > MAX_TAG_CHARS or tag != tag.lower():
                found.append(f"file {f.id}: tag {tag!r} is not a short lowercase word")

    known = set(file_ids)
    for q in queries:
        if q.lang not in LANGUAGES:
            found.append(f"query {q.id}: language {q.lang!r} is not one of {LANGUAGES}")
        if not q.relevant:
            found.append(f"query {q.id}: no relevant file, so nothing can be scored")
        elif 3 not in q.relevant.values():
            found.append(f"query {q.id}: no file is graded 3, the one the person means")
        for file_id, grade in q.relevant.items():
            if file_id not in known:
                found.append(f"query {q.id}: file {file_id} is not in the corpus")
            if grade not in GRADES:
                found.append(f"query {q.id}: grade {grade} for {file_id} is not one of {GRADES}")
    return found
