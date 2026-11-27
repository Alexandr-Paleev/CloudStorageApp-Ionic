"""How a model's choice of tool is graded: the specification of `tool_choice.py`.

Each case is a request and the calls a model made, with the grade worked out
by hand. No network and no model.
"""

from __future__ import annotations

import json

import pytest

from search_evals.backends import chat_tool_calls
from search_evals.contract import MCP_INSTRUCTIONS, MCP_TOOLS
from search_evals.tool_choice import (
    TOOL_NAMES,
    Call,
    Choice,
    ChoiceCache,
    Request,
    grade_choice,
    load_requests,
    message_hash,
    problems,
    schema_problems,
    tools_payload,
)

LEASE = Request(id="t1", lang="ru", text="Найди договор аренды", tools=("search_files",), terms=("аренд", "lease"))
ASK = Request(id="t2", lang="en", text="When does my lease end?", tools=("ask_files",), terms=("lease",))
ALL = Request(id="t3", lang="en", text="What files do I have?", tools=("list_files",))
TAXES = Request(id="t4", lang="en", text="What's in Taxes/2026?", tools=("list_files",), folder="Taxes/2026")
TOP = Request(id="t5", lang="en", text="Which files are in no folder?", tools=("list_files",), folder="/")
DELETE = Request(id="t6", lang="en", text="Delete the old bills.", tools=())


def call(name: str, **arguments: object) -> Call:
    return Call(name, json.dumps(arguments, ensure_ascii=False))


def test_the_tools_offered_are_the_servers_word_for_word() -> None:
    assert TOOL_NAMES == ("search_files", "ask_files", "list_files")
    assert "read only" in MCP_INSTRUCTIONS
    for offered, served in zip(tools_payload(), MCP_TOOLS, strict=True):
        assert offered["function"] == {
            "name": served["name"],
            "description": served["description"],
            "parameters": served["inputSchema"],
        }


def test_the_right_tool_with_what_was_asked_is_right_in_every_way() -> None:
    g = grade_choice(LEASE, [call("search_files", query="договор аренды квартиры")])
    assert (g.chosen, g.right_tool, g.valid, g.right_arguments, g.flaws) == ("search_files", True, True, True, ())


def test_a_term_is_matched_inside_words_and_in_any_case() -> None:
    # "аренд" is the stem of аренда, аренды, арендная; "Lease" is "lease".
    assert grade_choice(LEASE, [call("search_files", query="Lease agreement")]).right_arguments


def test_a_query_written_in_another_alphabet_holds_none_of_the_terms() -> None:
    # Seen: a model that wrote Russian in Latin letters, which the search's
    # model does not read as the Russian words.
    g = grade_choice(LEASE, [call("search_files", query="dogovor arendy")])
    assert (g.right_tool, g.valid, g.right_arguments) == (True, True, False)
    assert "holds none of" in g.flaws[0]


def test_another_tool_is_the_wrong_tool_and_its_arguments_are_not_judged() -> None:
    g = grade_choice(LEASE, [call("ask_files", question="Where is my lease?")])
    assert (g.chosen, g.right_tool, g.valid, g.right_arguments) == ("ask_files", False, True, None)
    assert g.flaws == ("called ask_files",)


def test_any_of_the_right_tools_will_do() -> None:
    either = Request(id="t7", lang="es", text="¿Tengo algo del seguro?", tools=("search_files", "ask_files"), terms=("seguro",))
    assert grade_choice(either, [call("ask_files", question="¿Tengo algún seguro?")]).right_tool


def test_no_call_is_right_only_where_no_tool_fits() -> None:
    assert grade_choice(DELETE, []).right_tool
    g = grade_choice(ASK, [])
    assert (g.chosen, g.right_tool, g.valid, g.right_arguments, g.flaws) == (None, False, None, None, ("called no tool",))


def test_a_call_where_no_tool_fits_is_wrong_however_harmless() -> None:
    g = grade_choice(DELETE, [call("ask_files", question="What are the old bills?")])
    assert (g.right_tool, g.flaws) == (False, ("called ask_files where no tool fits",))


def test_a_tool_the_server_does_not_have_is_wrong_and_invalid() -> None:
    g = grade_choice(ASK, [call("delete_files", ids=["f1"])])
    assert (g.chosen, g.right_tool, g.valid) == ("delete_files", False, False)


def test_arguments_that_are_not_json_are_a_finding() -> None:
    g = grade_choice(ASK, [Call("ask_files", "{question: lease")])
    assert (g.right_tool, g.valid, g.right_arguments) == (True, False, False)
    assert g.flaws == ("arguments are not JSON",)


def test_no_arguments_at_all_are_an_empty_object() -> None:
    assert grade_choice(ALL, [Call("list_files", "")]).right_arguments


@pytest.mark.parametrize(
    ("arguments", "flaw"),
    [
        ({"limit": "1"}, "arguments.limit is not an integer"),
        ({"limit": True}, "arguments.limit is not an integer"),
        ({"limit": 0}, "arguments.limit is below 1"),
        ({"limit": 101}, "arguments.limit is above 100"),
        ({"offset": -1}, "arguments.offset is below 0"),
        ({"folder": 7}, "arguments.folder is not a string"),
    ],
)
def test_arguments_the_server_would_refuse_are_invalid(arguments: dict, flaw: str) -> None:
    g = grade_choice(ALL, [call("list_files", **arguments)])
    assert (g.right_tool, g.valid, g.right_arguments) == (True, False, False)
    assert g.flaws == (flaw,)


def test_a_missing_or_overlong_query_is_invalid() -> None:
    schema = {t["name"]: t["inputSchema"] for t in MCP_TOOLS}["search_files"]
    assert schema_problems({}, schema) == ["arguments.query is missing"]
    assert schema_problems({"query": ""}, schema) == ["arguments.query is shorter than 1"]
    assert schema_problems({"query": "x" * 501}, schema) == ["arguments.query is longer than 500"]
    assert schema_problems({"query": "x" * 500}, schema) == []
    assert schema_problems([], schema) == ["arguments is not an object"]


def test_every_file_asked_for_means_no_folder() -> None:
    assert grade_choice(ALL, [call("list_files")]).right_arguments
    # A limit is the model's to choose: the listing says when there is more.
    assert grade_choice(ALL, [call("list_files", limit=10)]).right_arguments
    g = grade_choice(ALL, [call("list_files", folder="/")])
    assert (g.right_arguments, g.flaws) == (False, ("listed only the folder '/', and every file was asked for",))


def test_a_folder_is_compared_as_the_route_compares_it() -> None:
    # plainPath in api/ai/[action].ts drops the slashes at either end.
    assert grade_choice(TAXES, [call("list_files", folder="Taxes/2026")]).right_arguments
    assert grade_choice(TAXES, [call("list_files", folder="/Taxes/2026/")]).right_arguments
    assert not grade_choice(TAXES, [call("list_files", folder="taxes/2026")]).right_arguments
    assert not grade_choice(TAXES, [call("list_files", folder="Taxes")]).right_arguments
    assert not grade_choice(TAXES, [call("list_files")]).right_arguments


def test_the_top_is_slash_or_nothing_between_slashes() -> None:
    assert grade_choice(TOP, [call("list_files", folder="/")]).right_arguments
    assert grade_choice(TOP, [call("list_files", folder="")]).right_arguments
    assert not grade_choice(TOP, [call("list_files")]).right_arguments


def test_the_first_call_is_graded_and_the_rest_counted() -> None:
    g = grade_choice(ASK, [call("ask_files", question="lease end?"), call("list_files")])
    assert (g.chosen, g.right_tool, g.calls) == ("ask_files", True, 2)


def test_the_data_in_the_repository_has_no_problems() -> None:
    requests = load_requests()
    assert problems(requests) == []
    assert len(requests) == 60
    for lang in ("en", "es", "ru"):
        assert sum(r.lang == lang for r in requests) == 20


def test_problems_name_what_is_wrong() -> None:
    bad = [
        Request(id="x1", lang="en", text="a", tools=("search_files",)),
        Request(id="x1", lang="de", text=" ", tools=("rename_file",)),
        Request(id="x2", lang="en", text="b", tools=("list_files",), terms=("Lease",)),
        Request(id="x3", lang="en", text="c", tools=("ask_files",), terms=("x",), folder="Work"),
    ]
    found = "\n".join(problems(bad))
    for expected in (
        "x1: search_files and ask_files need terms",
        "x1: the id is used twice",
        "language 'de'",
        "x1: the text is empty",
        "['rename_file'] are not tools",
        "x2: terms are checked only for",
        "x2: a term is empty or not in lower case",
        "x3: a folder is checked only for list_files",
        "no es request is right for",
    ):
        assert expected in found


def test_a_choice_is_asked_again_when_what_the_model_is_told_changes() -> None:
    first = message_hash("@cf/m", "What files do I have?")
    assert message_hash("@cf/m", "What files do I have?") == first
    assert message_hash("@cf/m", "What files do I have now?") != first
    assert message_hash("@cf/other", "What files do I have?") != first


def test_the_cache_keeps_the_calls_as_written(tmp_path) -> None:
    cache = ChoiceCache("@cf/m", root=tmp_path)
    cache.put(Choice(id="e1", message_hash="h", calls=[Call("list_files", '{"limit": "1"}')], content=None, neurons=21.5))
    cache.save()
    again = ChoiceCache("@cf/m", root=tmp_path)
    assert again.get("e1", "h") == Choice(id="e1", message_hash="h", calls=[Call("list_files", '{"limit": "1"}')], content=None, neurons=21.5)
    assert again.get("e1", "other") is None
    assert cache.path.name == "tools-cf-m.jsonl"


def test_both_shapes_of_a_workers_ai_answer_are_read() -> None:
    # As chat completions: the arguments a JSON string, the cost in usage.
    modern = {
        "choices": [
            {"message": {"content": None, "tool_calls": [{"type": "function", "function": {"name": "ask_files", "arguments": '{"question": "q"}'}}]}}
        ],
        "usage": {"neurons": 23.4},
    }
    assert chat_tool_calls(modern) == ([("ask_files", '{"question": "q"}')], None, 23.4)
    # The older shape: the arguments an object, the text in `response`.
    older = {"response": " I cannot delete files. ", "tool_calls": [{"name": "list_files", "arguments": {"folder": "Фото"}}]}
    assert chat_tool_calls(older) == ([("list_files", '{"folder": "Фото"}')], "I cannot delete files.", None)
    assert chat_tool_calls({"choices": [{"message": {"content": "", "tool_calls": None}}]}) == ([], None, None)
