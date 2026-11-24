"""The answers a model gave, kept in the repository like the vectors.

`cache/answers-<model>.jsonl` has one line per question: the pieces it was
given, a hash of the exact message, and the answer. A reader can see every
answer in a diff, and `score-answers` grades them with no key and no network,
in CI too. Change the instruction, the pieces or a question's wording, and
the hash no longer matches: `answer` asks that question again.

The field is `message_hash`, never `key`: gitleaks takes a long hex string
next to the word key for a secret, and fails the whole branch's history.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .vectors import CACHE, slug


def message_hash(model: str, system: str, user: str, max_tokens: int) -> str:
    return hashlib.sha256(json.dumps([model, system, user, max_tokens], ensure_ascii=False).encode()).hexdigest()


@dataclass(frozen=True)
class Answer:
    id: str
    message_hash: str
    pieces: list[str]
    answer: str


class AnswerCache:
    def __init__(self, model: str, root: Path = CACHE) -> None:
        self.path = root / f"answers-{slug(model)}.jsonl"
        self._rows: dict[str, Answer] = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = Answer(**json.loads(line))
                    self._rows[row.id] = row

    def __len__(self) -> int:
        return len(self._rows)

    def get(self, question_id: str, message_hash: str) -> Answer | None:
        """The cached answer to exactly this message, or None."""
        row = self._rows.get(question_id)
        return row if row is not None and row.message_hash == message_hash else None

    def put(self, row: Answer) -> None:
        self._rows[row.id] = row

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(asdict(self._rows[i]), ensure_ascii=False) for i in sorted(self._rows)]
        self.path.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
