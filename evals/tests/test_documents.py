"""The documents and questions in data/, held to what documents.py promises."""

from __future__ import annotations

from search_evals.documents import Document, Evidence, Question, load_documents, load_questions, problems


def test_the_data_in_the_repository_has_no_problems() -> None:
    assert problems(load_documents(), load_questions()) == []


def test_every_language_asks_and_answers() -> None:
    documents, questions = load_documents(), load_questions()
    for lang in ("en", "es", "ru"):
        assert any(d.lang == lang for d in documents)
        assert sum(q.lang == lang and q.answerable for q in questions) >= 15


def test_some_questions_have_no_answer_in_the_files() -> None:
    assert sum(not q.answerable for q in load_questions()) >= 10


DOC = Document(id="d1", name="lease.pdf", lang="en", text="The rent is 950\neuros a month.")


def question(**overrides: object) -> Question:
    fields: dict[str, object] = {
        "id": "a1",
        "text": "rent?",
        "lang": "en",
        "evidence": (Evidence("d1", "rent is 950 euros"),),
        "answer": "950 euros",
    }
    fields.update(overrides)
    return Question(**fields)  # type: ignore[arg-type]


def test_a_quote_may_cross_a_line_break() -> None:
    assert problems([DOC], [question()]) == []


def test_a_quote_the_document_does_not_hold_is_a_problem() -> None:
    assert problems([DOC], [question(evidence=(Evidence("d1", "rent is 960"),))]) == [
        "question a1: d1 does not say 'rent is 960'"
    ]


def test_evidence_in_a_missing_document_is_a_problem() -> None:
    assert problems([DOC], [question(evidence=(Evidence("d9", "x"),))]) == ["question a1: document d9 does not exist"]


def test_an_answer_without_evidence_is_a_problem() -> None:
    assert problems([DOC], [question(evidence=())]) == [
        "question a1: evidence and a reference answer go together, or neither"
    ]


def test_a_question_without_an_answer_is_fine_when_it_has_no_evidence() -> None:
    assert problems([DOC], [question(evidence=(), answer=None)]) == []


def test_duplicate_ids_and_unknown_languages_are_problems() -> None:
    assert problems([DOC, DOC], [question(lang="fr")]) == [
        "document id d1 is used more than once",
        "question a1: language 'fr' is not one of ('en', 'es', 'ru')",
    ]
