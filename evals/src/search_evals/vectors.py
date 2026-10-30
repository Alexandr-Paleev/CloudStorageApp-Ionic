"""Vectors, kept in the repository so that scoring needs no key and no network.

One file per model in `cache/`. A vector is filed under a hash of the text and
of the side of the search it was made for: Voyage embeds a document and a query
differently, so the same words on the two sides are two vectors. Changing a
file's summary or a query's wording changes the hash, and `embed` fetches only
what is missing.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np

CACHE = Path(__file__).resolve().parents[2] / "cache"
SIDES = ("document", "query")


def slug(model: str) -> str:
    """`@cf/baai/bge-large-en-v1.5` becomes `cf-baai-bge-large-en-v1-5`."""
    return re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-")


def key(text: str, side: str) -> str:
    if side not in SIDES:
        raise ValueError(f"side must be one of {SIDES}, not {side!r}")
    return hashlib.sha256(f"{side}\n{text}".encode()).hexdigest()


class VectorCache:
    def __init__(self, model: str, root: Path = CACHE) -> None:
        self.model = model
        self.path = root / f"{slug(model)}.npz"
        self._vectors: dict[str, np.ndarray] = {}
        if self.path.exists():
            with np.load(self.path) as stored:
                self._vectors = dict(zip(stored["keys"].tolist(), stored["vectors"]))

    def __len__(self) -> int:
        return len(self._vectors)

    def get(self, text: str, side: str) -> np.ndarray | None:
        return self._vectors.get(key(text, side))

    def put(self, text: str, side: str, vector: list[float] | np.ndarray) -> None:
        self._vectors[key(text, side)] = np.asarray(vector, dtype=np.float32)

    def missing(self, items: list[tuple[str, str]]) -> list[tuple[str, str]]:
        """The (text, side) pairs this cache has no vector for, each once."""
        seen: set[str] = set()
        out: list[tuple[str, str]] = []
        for text, side in items:
            k = key(text, side)
            if k not in self._vectors and k not in seen:
                seen.add(k)
                out.append((text, side))
        return out

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        keys = sorted(self._vectors)
        np.savez_compressed(
            self.path,
            keys=np.array(keys),
            vectors=np.stack([self._vectors[k] for k in keys]) if keys else np.zeros((0, 0), np.float32),
        )
