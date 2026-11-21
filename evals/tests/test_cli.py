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
    # into the ranking, and ends in the table.
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

    assert main(["score", "--model", "fake"]) == 0
    out, err = capsys.readouterr()
    assert "not cached" not in err
    assert "recall@5" in out


def test_score_uses_the_apps_floor_for_the_model_unless_told(capsys: pytest.CaptureFixture[str]) -> None:
    # From the vectors in cache/, which CI scores too.
    assert main(["score", "--model", "@cf/baai/bge-m3"]) == 0
    assert "min similarity 0.4\n" in capsys.readouterr().out
    assert main(["score", "--model", "@cf/baai/bge-m3", "--min-similarity", "0.5"]) == 0
    assert "min similarity 0.5\n" in capsys.readouterr().out


def test_score_chunks_says_which_command_fetches_what_is_missing(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["score-chunks", "--model", "voyage-none"]) == 2
    captured = capsys.readouterr()
    assert "run `search-evals embed-chunks --model voyage-none`" in captured.err
    assert captured.out == ""


def test_score_chunks_scores_every_size_from_the_cache(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A stand-in model that embeds every text as the letters it holds: crude,
    # but deterministic, so the table can be checked for shape and bounds.
    import numpy as np

    from search_evals import cli

    class Letters:
        def __init__(self, model: str) -> None:
            pass

        def get(self, text: str, side: str) -> np.ndarray:
            vector = np.zeros(64, dtype=np.float32)
            for char in text.lower():
                vector[ord(char) % 64] += 1
            return vector

    monkeypatch.setattr(cli, "VectorCache", Letters)

    assert main(["score-chunks", "--model", "letters", "--sizes", "400,1600"]) == 0
    lines = capsys.readouterr().out.splitlines()
    sizes = [line.split()[0] for line in lines[2:] if line.split()[1] == "all"]
    assert sizes == ["400", "1600"]
    for line in lines[2:]:
        recall_3, recall_k, complete, mrr = (float(value) for value in line.split()[-6:-2])
        assert 0 <= recall_3 <= recall_k <= 1 and 0 <= complete <= 1 and 0 <= mrr <= 1


def test_check_reads_the_documents_and_their_questions_too(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from search_evals import cli
    from search_evals.documents import Evidence, Question

    wrong = Question(id="a1", text="rent?", lang="en", evidence=(Evidence("d01", "the rent is 9999"),), answer="x")
    monkeypatch.setattr(cli, "load_questions", lambda: [wrong])

    assert main(["check"]) == 1
    assert "d01 does not say 'the rent is 9999'" in capsys.readouterr().err
