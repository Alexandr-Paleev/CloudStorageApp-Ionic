from __future__ import annotations

import pytest

from search_evals.cli import main


def test_check_passes_on_the_data_in_the_repository() -> None:
    assert main(["check"]) == 0


def test_score_says_which_command_fetches_what_is_missing(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["score", "--model", "voyage-none"]) == 2
    assert "run `search-evals embed --model voyage-none`" in capsys.readouterr().err
