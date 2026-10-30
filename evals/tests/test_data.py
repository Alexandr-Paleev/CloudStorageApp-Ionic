from __future__ import annotations

from search_evals.data import LANGUAGES, File, Query, load_files, load_queries, only_across_languages, problems


def test_the_data_in_the_repository_has_nothing_wrong_with_it() -> None:
    assert problems(load_files(), load_queries()) == []


def test_every_language_is_asked_about() -> None:
    asked = {q.lang for q in load_queries()}
    assert asked == set(LANGUAGES)


def test_a_label_for_a_file_that_is_not_there_is_found() -> None:
    files = [File(id="f1", name="a.txt", lang="en", summary="A note.", tags=("note",))]
    queries = [
        Query(id="q1", text="note", lang="en", relevant={"f9": 3}),
        Query(id="q2", text="note", lang="de", relevant={}),
        Query(id="q3", text="note", lang="en", relevant={"f1": 5}),
        Query(id="q4", text="note", lang="en", relevant={"f1": 1}),
    ]
    found = problems(files, queries)
    assert "query q1: file f9 is not in the corpus" in found
    assert "query q2: language 'de' is not one of ('en', 'es', 'ru')" in found
    assert "query q2: no relevant file, so nothing can be scored" in found
    assert "query q3: grade 5 for f1 is not one of (1, 2, 3)" in found
    assert "query q4: no file is graded 3, the one the person means" in found


def test_a_summary_or_a_tag_the_table_would_refuse_is_found() -> None:
    files = [
        File(id="f1", name="a.txt", lang="en", summary="x" * 501, tags=("Upper",)),
        File(id="f1", name="b.txt", lang="en", summary="ok", tags=tuple(f"t{i}" for i in range(13))),
    ]
    found = problems(files, [])
    assert "file id f1 is used more than once" in found
    assert "file f1: the summary is 501 characters" in found
    assert "file f1: tag 'Upper' is not a short lowercase word" in found
    assert "file f1: 13 tags, the table holds 12" in found


def test_a_query_is_across_languages_only_when_no_file_it_means_shares_its_language() -> None:
    files = {
        "en": File(id="en", name="a.pdf", lang="en", summary="An invoice.", tags=()),
        "ru": File(id="ru", name="b.pdf", lang="ru", summary="Счёт.", tags=()),
    }
    assert only_across_languages(Query(id="q", text="счёт", lang="ru", relevant={"en": 3}), files)
    assert not only_across_languages(Query(id="q", text="счёт", lang="ru", relevant={"ru": 3, "en": 3}), files)
    # A related file in the query's language does not make it answerable: only grade 3 counts.
    assert only_across_languages(Query(id="q", text="счёт", lang="ru", relevant={"en": 3, "ru": 1}), files)
