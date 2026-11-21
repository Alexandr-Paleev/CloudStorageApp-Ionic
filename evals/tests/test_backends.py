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


class _Answer:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "_Answer":
        return self

    def __exit__(self, *args: object) -> None:
        pass

    def read(self) -> bytes:
        return self.body


def _limited(code: int, retry_after: str | None = None):
    import email.message
    import io
    import urllib.error

    headers = email.message.Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://x", code, "no", headers, io.BytesIO(b'{"detail":"slow down"}'))


def test_a_rate_limit_is_waited_out_and_the_request_sent_again(monkeypatch: pytest.MonkeyPatch) -> None:
    from search_evals import backends

    answers = [_limited(429, "7"), _limited(429), _Answer(b'{"ok": true}')]

    def urlopen(request, timeout):  # noqa: ANN001
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    waits: list[float] = []
    monkeypatch.setattr(backends.urllib.request, "urlopen", urlopen)

    assert backends._post("https://x", "t", {}, sleep=waits.append) == {"ok": True}
    assert waits == [7.0, backends.RATE_LIMIT_WAIT_S]


def test_a_rate_limit_that_does_not_end_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from search_evals import backends

    def urlopen(request, timeout):  # noqa: ANN001
        raise _limited(429)

    monkeypatch.setattr(backends.urllib.request, "urlopen", urlopen)

    with pytest.raises(RuntimeError, match="answered 429"):
        backends._post("https://x", "t", {}, sleep=lambda seconds: None)


def test_another_error_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    from search_evals import backends

    calls: list[int] = []

    def urlopen(request, timeout):  # noqa: ANN001
        calls.append(1)
        raise _limited(401)

    monkeypatch.setattr(backends.urllib.request, "urlopen", urlopen)

    with pytest.raises(RuntimeError, match="answered 401"):
        backends._post("https://x", "t", {}, sleep=lambda seconds: None)
    assert calls == [1]
