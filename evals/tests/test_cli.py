from __future__ import annotations

import pytest

from search_evals.cli import main


def test_check_passes_on_the_data_in_the_repository() -> None:
    assert main(["check"]) == 0


def test_score_says_which_command_fetches_what_is_missing(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["score", "--model", "voyage-none"]) == 2
    assert "run `search-evals embed --model voyage-none`" in capsys.readouterr().err


def test_score_refuses_data_that_check_rejects(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A label for a file that is not there. Without the refusal the run would
    # go on to the cache and end in "not cached" (2) instead.
    from search_evals import cli
    from search_evals.data import Query

    monkeypatch.setattr(cli, "load_queries", lambda: [Query(id="q1", text="note", lang="en", relevant={"f99": 3})])

    assert main(["score", "--model", "voyage-none"]) == 1
    assert "run `search-evals check`" in capsys.readouterr().err


def test_score_reads_a_full_cache_without_tripping_over_numpy(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Every vector present, so the run gets past the check for missing ones and
    # into the ranking. Until rank.py and metrics.py are written that ends in
    # "Not written yet" (3); after, in a table (0). Either way, no exception.
    from search_evals import cli
    from search_evals.contract import embedding_input
    from search_evals.data import load_files, load_queries
    from search_evals.vectors import VectorCache

    cache = VectorCache("fake", root=tmp_path)
    for i, f in enumerate(load_files()):
        cache.put(embedding_input(f.name, f.summary, f.tags), "document", [1.0, float(i)])
    for q in load_queries():
        cache.put(q.text, "query", [1.0, 0.5])
    cache.save()
    monkeypatch.setattr(cli, "VectorCache", lambda model: VectorCache(model, root=tmp_path))

    assert main(["score", "--model", "fake"]) in (0, 3)
    assert "not cached" not in capsys.readouterr().err
