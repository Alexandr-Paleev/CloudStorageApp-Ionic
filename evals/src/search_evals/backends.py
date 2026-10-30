"""The embedding models the app can run on, called the way the app calls them.

`libs/server/src/embeddings.ts` (Voyage) and `libs/server/src/cloudflare-ai.ts`
(Workers AI) are the app's side. What matters for a fair measurement is copied
from them: the model names, and that Voyage is told which side of the search a
text is on while Workers AI is not. Anything else, such as batching and the
absence of a timeout budget, is free to differ: this runs on a laptop, not in a
function a browser is waiting on.

Keys come from the environment. From the repository root:
`uv run --project evals --env-file .env search-evals embed --model voyage-4`.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable

VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings"
CLOUDFLARE_MODEL = "@cf/baai/bge-large-en-v1.5"
BATCH = 64
TIMEOUT_S = 60

Embedder = Callable[[list[str], str, str], list[list[float]]]


class MissingKey(RuntimeError):
    pass


def _post(url: str, token: str, body: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        # The start of the body only: an upstream error can be long.
        detail = error.read().decode(errors="replace")[:200]
        raise RuntimeError(f"{url} answered {error.code}: {detail}") from error


def voyage(texts: list[str], side: str, model: str) -> list[list[float]]:
    token = os.environ.get("VOYAGE_API_KEY")
    if not token:
        raise MissingKey("VOYAGE_API_KEY is not set")
    out: list[list[float]] = []
    for start in range(0, len(texts), BATCH):
        payload = _post(
            VOYAGE_ENDPOINT, token, {"input": texts[start : start + BATCH], "model": model, "input_type": side}
        )
        out.extend(row["embedding"] for row in sorted(payload["data"], key=lambda row: row["index"]))
    return out


def _cloudflare_account() -> str | None:
    """CLOUDFLARE_ACCOUNT_ID, or the account in R2_ENDPOINT, as the app reads it."""
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if account:
        return account
    match = re.match(r"https://([0-9a-f]+)\.r2\.cloudflarestorage\.com", os.environ.get("R2_ENDPOINT", ""))
    return match.group(1) if match else None


def cloudflare(texts: list[str], side: str, model: str) -> list[list[float]]:
    # `side` is accepted and ignored, as the app ignores it: bge is not told
    # which side a text is on, and measuring it as the app runs it is the point.
    token = os.environ.get("CLOUDFLARE_AI_TOKEN")
    account = _cloudflare_account()
    if not token or not account:
        raise MissingKey("CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID (or R2_ENDPOINT) are needed")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"
    out: list[list[float]] = []
    for start in range(0, len(texts), BATCH):
        payload = _post(url, token, {"text": texts[start : start + BATCH]})
        if not payload.get("success", True):
            raise RuntimeError(f"Workers AI refused the batch: {str(payload.get('errors'))[:200]}")
        out.extend(payload["result"]["data"])
    return out


def embedder(model: str) -> Embedder:
    if model.startswith("voyage-"):
        return voyage
    if model == CLOUDFLARE_MODEL:
        return cloudflare
    raise ValueError(f"no backend for {model!r}: voyage-* or {CLOUDFLARE_MODEL}")
