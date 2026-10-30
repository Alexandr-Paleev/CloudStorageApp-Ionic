"""What this eval has to agree with the app on, read from the app's own file.

The app is TypeScript and this is Python, so neither can import the other. The
values both depend on live in `libs/core/src/ai.eval-contract.json`, and each
side has a test that holds its copy to that file: `libs/core/src/ai.test.ts`
for the app, `tests/test_contract.py` for this. A threshold tuned here against
a different model, or text embedded differently from what the app embeds,
would be a measurement of a system that does not ship.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPO / "libs" / "core" / "src" / "ai.eval-contract.json"

_contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CONSTANTS: dict[str, str | int | float] = _contract["constants"]
EMBEDDING_INPUT_CASES: list[dict] = _contract["embeddingInput"]

EMBEDDING_MODEL = str(CONSTANTS["EMBEDDING_MODEL"])
EMBEDDING_DIMENSIONS = int(CONSTANTS["EMBEDDING_DIMENSIONS"])
MAX_SUMMARY_CHARS = int(CONSTANTS["MAX_SUMMARY_CHARS"])
MAX_TAGS = int(CONSTANTS["MAX_TAGS"])
MAX_TAG_CHARS = int(CONSTANTS["MAX_TAG_CHARS"])
SEARCH_RESULTS = int(CONSTANTS["SEARCH_RESULTS"])
SEARCH_MIN_SIMILARITY = float(CONSTANTS["SEARCH_MIN_SIMILARITY"])


def embedding_input(name: str, summary: str, tags: Sequence[str]) -> str:
    """The text a file is embedded as: `embeddingInput` in libs/core/src/ai.ts.

    The name first, because it is the one part a person chose; then the
    sentence the model wrote; then the tags on one line. Empty parts are left
    out rather than kept as blank lines.
    """
    parts = [name, summary]
    if tags:
        parts.append(", ".join(tags))
    return "\n".join(part.strip() for part in parts if part.strip())
