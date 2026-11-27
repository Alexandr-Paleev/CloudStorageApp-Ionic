"""Whether a model picks the right tool of `/mcp`, and passes it what the
person asked (docs/decisions/0020, step M3).

A request is something a person says to an assistant that has Cloud Storage
connected. `data/tool_requests.jsonl` holds them, one JSON object per line:

```json
{"id": "e07", "lang": "en", "text": "When does my lease end?", "tools": ["ask_files"], "terms": ["lease"]}
{"id": "e15", "lang": "en", "text": "What's in my Taxes/2026 folder?", "tools": ["list_files"], "folder": "Taxes/2026"}
```

- **tools**: the tools that are right for it, any one of them; `[]` when none
  is, as for a request to delete or share a file, which nothing here does, or
  about the weather.
- **terms**: for `search_files` and `ask_files`, words of which the query or
  the question must hold one. In lower case, and matched inside words, so
  that a Russian stem matches every ending; in more than one language,
  because the model may put the query in any.
- **folder**: for `list_files`, the folder's path the person named. Left out,
  no folder may be given: a folder lists only what is directly in it.

The model is told what an assistant connected to `/mcp` is told: the server's
instructions as the system message and the tools as `tools/list` gives them,
both from `libs/server/src/mcp.eval-contract.json`. An assistant's own client
adds instructions of its own, which differ from one client to the next; this
measures what the server says, with nothing in front of it.

What it chose is kept in `cache/tools-<model>.jsonl` and graded with no model
and no network, as the answers are (`answers.py`).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .contract import MCP_INSTRUCTIONS, MCP_TOOLS
from .data import DATA, LANGUAGES, _lines
from .vectors import CACHE, slug

REQUESTS_PATH = DATA / "tool_requests.jsonl"
TOOL_NAMES = tuple(tool["name"] for tool in MCP_TOOLS)
SCHEMAS: dict[str, dict] = {tool["name"]: tool["inputSchema"] for tool in MCP_TOOLS}
# The argument whose words are checked against a request's terms.
TEXT_ARGUMENT = {"search_files": "query", "ask_files": "question"}
# Enough for one call with its arguments; a model that writes prose instead is
# graded on the call it did not make, not cut off before it.
MAX_CHOICE_TOKENS = 256


@dataclass(frozen=True)
class Request:
    id: str
    lang: str
    text: str
    tools: tuple[str, ...]
    terms: tuple[str, ...] = ()
    folder: str | None = None


def load_requests(path: Path = REQUESTS_PATH) -> list[Request]:
    return [
        Request(
            id=row["id"],
            lang=row["lang"],
            text=row["text"],
            tools=tuple(row["tools"]),
            terms=tuple(row.get("terms", ())),
            folder=row.get("folder"),
        )
        for row in _lines(path)
    ]


def problems(requests: Sequence[Request]) -> list[str]:
    """What is wrong with the requests, as `check` reports it."""
    found: list[str] = []
    seen: set[str] = set()
    for r in requests:
        where = f"tool_requests {r.id}"
        if r.id in seen:
            found.append(f"{where}: the id is used twice")
        seen.add(r.id)
        if r.lang not in LANGUAGES:
            found.append(f"{where}: language {r.lang!r} is not one of {LANGUAGES}")
        if not r.text.strip():
            found.append(f"{where}: the text is empty")
        unknown = [t for t in r.tools if t not in TOOL_NAMES]
        if unknown:
            found.append(f"{where}: {unknown} are not tools of /mcp {TOOL_NAMES}")
        if len(set(r.tools)) != len(r.tools):
            found.append(f"{where}: a tool is listed twice")
        needs_terms = any(t in TEXT_ARGUMENT for t in r.tools)
        if needs_terms and not r.terms:
            found.append(f"{where}: search_files and ask_files need terms to check the query by")
        if r.terms and not needs_terms:
            found.append(f"{where}: terms are checked only for search_files and ask_files")
        if any(t != t.lower() or not t.strip() for t in r.terms):
            found.append(f"{where}: a term is empty or not in lower case")
        if r.folder is not None and "list_files" not in r.tools:
            found.append(f"{where}: a folder is checked only for list_files")
    for lang in LANGUAGES:
        kinds = {t for r in requests if r.lang == lang for t in (r.tools or ("none",))}
        missing = [k for k in (*TOOL_NAMES, "none") if k not in kinds]
        if missing:
            found.append(f"tool_requests: no {lang} request is right for {missing}")
    return found


def tools_payload() -> list[dict]:
    """The tools as a chat model with function calling takes them."""
    return [
        {
            "type": "function",
            "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]},
        }
        for t in MCP_TOOLS
    ]


def message_hash(model: str, text: str) -> str:
    payload = [model, MCP_INSTRUCTIONS, text, tools_payload(), MAX_CHOICE_TOKENS]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class Call:
    name: str
    # As the model wrote them, unparsed: arguments that are not JSON are a
    # finding, not an error of the eval.
    arguments: str


@dataclass(frozen=True)
class Choice:
    id: str
    message_hash: str
    calls: list[Call]
    # What it said instead of, or as well as, calling.
    content: str | None
    neurons: float | None = None


class ChoiceCache:
    """`cache/tools-<model>.jsonl`, one line per request, like the answers'."""

    def __init__(self, model: str, root: Path = CACHE) -> None:
        self.path = root / f"tools-{slug(model)}.jsonl"
        self._rows: dict[str, Choice] = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    row["calls"] = [Call(**c) for c in row["calls"]]
                    self._rows[row["id"]] = Choice(**row)

    def __len__(self) -> int:
        return len(self._rows)

    def get(self, request_id: str, digest: str) -> Choice | None:
        row = self._rows.get(request_id)
        return row if row is not None and row.message_hash == digest else None

    def put(self, row: Choice) -> None:
        self._rows[row.id] = row

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(asdict(self._rows[i]), ensure_ascii=False) for i in sorted(self._rows)]
        self.path.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")


def schema_problems(value: object, schema: dict, where: str = "arguments") -> list[str]:
    """What in `value` the tool's input schema refuses.

    The part of JSON Schema the three tools use: objects with properties and
    required ones, strings with lengths, integers with bounds. The server
    validates the same way before a tool runs, so arguments refused here are
    refused there.
    """
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return [f"{where} is not an object"]
        found = [f"{where}.{name} is missing" for name in schema.get("required", []) if name not in value]
        for name, sub in schema.get("properties", {}).items():
            if name in value:
                found += schema_problems(value[name], sub, f"{where}.{name}")
        return found
    if kind == "string":
        if not isinstance(value, str):
            return [f"{where} is not a string"]
        if len(value) < schema.get("minLength", 0):
            return [f"{where} is shorter than {schema['minLength']}"]
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return [f"{where} is longer than {schema['maxLength']}"]
        return []
    if kind == "integer":
        # A bool is an int to Python and not to JSON Schema.
        if not isinstance(value, int) or isinstance(value, bool):
            return [f"{where} is not an integer"]
        if "minimum" in schema and value < schema["minimum"]:
            return [f"{where} is below {schema['minimum']}"]
        if "maximum" in schema and value > schema["maximum"]:
            return [f"{where} is above {schema['maximum']}"]
        return []
    return []


def plain_path(path: str) -> str:
    """A folder's path as the route compares it: `plainPath` in api/ai/[action].ts."""
    return path.strip("/")


@dataclass(frozen=True)
class ChoiceGrade:
    # The first tool called, None for none: what an assistant does first.
    chosen: str | None
    right_tool: bool
    # Whether the arguments pass the schema; None when nothing was called.
    valid: bool | None
    # Whether they say what was asked; None unless the right tool was called.
    right_arguments: bool | None
    calls: int
    flaws: tuple[str, ...] = field(default=())


def grade_choice(request: Request, calls: Sequence[Call]) -> ChoiceGrade:
    if not calls:
        right = not request.tools
        return ChoiceGrade(None, right, None, None, 0, () if right else ("called no tool",))
    first = calls[0]
    if first.name not in SCHEMAS:
        return ChoiceGrade(first.name, False, False, None, len(calls), (f"called {first.name!r}, which /mcp does not have",))
    right_tool = first.name in request.tools
    flaws: list[str] = []
    if not right_tool:
        flaws.append(f"called {first.name}" + ("" if request.tools else " where no tool fits"))
    try:
        arguments = json.loads(first.arguments) if first.arguments.strip() else {}
    except json.JSONDecodeError:
        return ChoiceGrade(first.name, right_tool, False, False if right_tool else None, len(calls), (*flaws, "arguments are not JSON"))
    refused = schema_problems(arguments, SCHEMAS[first.name])
    flaws += refused
    if not right_tool:
        return ChoiceGrade(first.name, False, not refused, None, len(calls), tuple(flaws))
    right_arguments = not refused and _says_what_was_asked(request, first.name, arguments, flaws)
    return ChoiceGrade(first.name, True, not refused, right_arguments, len(calls), tuple(flaws))


def _says_what_was_asked(request: Request, tool: str, arguments: dict, flaws: list[str]) -> bool:
    if tool in TEXT_ARGUMENT:
        text = str(arguments.get(TEXT_ARGUMENT[tool], "")).lower()
        if not any(term in text for term in request.terms):
            flaws.append(f"{TEXT_ARGUMENT[tool]} {text!r} holds none of {list(request.terms)}")
            return False
        return True
    # list_files
    given = arguments.get("folder")
    if request.folder is None:
        if given is not None:
            flaws.append(f"listed only the folder {given!r}, and every file was asked for")
            return False
        return True
    if not isinstance(given, str) or plain_path(given) != plain_path(request.folder):
        flaws.append(f"folder {given!r}, not {request.folder!r}")
        return False
    return True


def expected_kind(request: Request) -> str:
    """The row of the confusion table: the first right tool, or none."""
    return request.tools[0] if request.tools else "none"
