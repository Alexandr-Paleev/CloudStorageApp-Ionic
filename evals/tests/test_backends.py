"""Which function fetches a model's vectors. No network: only the choice."""

from __future__ import annotations

import pytest

from search_evals.backends import cloudflare, embedder, voyage


@pytest.mark.parametrize(
    ("model", "expected"),
    [("voyage-4", voyage), ("@cf/baai/bge-large-en-v1.5", cloudflare), ("@cf/baai/bge-m3", cloudflare)],
)
def test_each_model_has_its_backend(model: str, expected) -> None:
    assert embedder(model) is expected


def test_an_unknown_model_is_refused_rather_than_sent_somewhere() -> None:
    with pytest.raises(ValueError):
        embedder("@cf/some/other-model")
