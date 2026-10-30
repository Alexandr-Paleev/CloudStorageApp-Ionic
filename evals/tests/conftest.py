from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest


@pytest.fixture
def yours() -> Callable[..., Any]:
    """Calls a function that is yours to write, and skips the test until it is.

    A skipped test says what is left to do; a failed one would turn CI red for
    work nobody has started, and make a red that means "broken" mean less.
    """

    def call(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        try:
            return function(*args, **kwargs)
        except NotImplementedError as error:
            pytest.skip(f"{function.__name__}: {error}")

    return call
