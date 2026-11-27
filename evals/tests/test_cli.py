from __future__ import annotations

import re

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


class TestAnswers:
    """`answer` and `score-answers`, with the model stood in for and the cache in a temporary folder."""

    @pytest.fixture
    def answers_in(self, tmp_path, monkeypatch: pytest.MonkeyPatch):
        from search_evals import cli
        from search_evals.answers import AnswerCache

        monkeypatch.setattr(cli, "AnswerCache", lambda model: AnswerCache(model, root=tmp_path))
        return tmp_path

    def test_score_answers_says_which_command_fetches_them(
        self, answers_in, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert main(["score-answers"]) == 2
        assert "75 answers are missing or stale; run `search-evals answer" in capsys.readouterr().err

    def test_asks_only_a_model_it_can_reach(self, answers_in, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["answer", "--model", "claude-opus-5-5"]) == 2
        assert "only Workers AI models" in capsys.readouterr().err

    def test_a_dry_run_asks_nothing(self, answers_in, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
        from search_evals import cli

        monkeypatch.setattr(cli, "cloudflare_answer", lambda *args: pytest.fail("asked the model"))
        assert main(["answer", "--dry-run"]) == 0
        assert "75 questions to ask" in capsys.readouterr().out

    def test_asks_each_question_once_then_grades_from_the_cache(
        self, answers_in, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        from search_evals import cli
        from search_evals.contract import ANSWER_SYSTEM, MAX_ANSWER_TOKENS

        seen: list[str] = []

        def model(system: str, user: str, name: str, max_tokens: int) -> str:
            assert (system, max_tokens) == (ANSWER_SYSTEM, MAX_ANSWER_TOKENS)
            seen.append(user)
            return "Your files don't say."

        monkeypatch.setattr(cli, "cloudflare_answer", model)
        assert main(["answer"]) == 0
        assert len(seen) == 75
        # The message names the pieces it was given and the language to answer in.
        assert seen[0].startswith("<excerpts>\n[1] ") and seen[0].endswith("Answer in Russian.")

        assert main(["answer"]) == 0
        assert len(seen) == 75  # nothing asked twice

        capsys.readouterr()
        assert main(["score-answers", "--verbose"]) == 0
        out = capsys.readouterr().out
        # A model that refuses everything is right ten times and wrong sixty-five.
        assert re.search(r"^all\s+65\s+0\.000\s+65\s", out, re.MULTILINE)
        assert re.search(r"^all\s+10\s+10\s", out, re.MULTILINE)
        assert "a01 (ru) refused" in out


def test_score_tools_grades_the_committed_choices_of_both_models(capsys: pytest.CaptureFixture[str]) -> None:
    # From cache/tools-*.jsonl, which CI grades too.
    for model in ("@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"):
        assert main(["score-tools", "--model", model]) == 0
        out = capsys.readouterr().out
        assert re.search(r"^all\s+60\s", out, re.MULTILINE)
        assert "Asked for (rows), called first (columns):" in out


def test_score_tools_says_which_command_asks_what_is_missing(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["score-tools", "--model", "@cf/none/model"]) == 2
    assert "run `search-evals choose --model @cf/none/model`" in capsys.readouterr().err


def test_choose_asks_workers_ai_alone(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["choose", "--model", "claude-none"]) == 2
    assert "only Workers AI models" in capsys.readouterr().err
