"""UTF-8 stdin/stdout interface for the deterministic geometry module."""

from __future__ import annotations

import json
import sys
from typing import Any

from .core import solve_geometry


MAX_INPUT_BYTES = 100 * 1024
MAX_JSON_DEPTH = 32


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"INVALID_JSON_CONSTANT:{value}")


def _depth(value: Any, current: int = 1) -> int:
    if isinstance(value, dict):
        return max([current, *(_depth(item, current + 1) for item in value.values())])
    if isinstance(value, list):
        return max([current, *(_depth(item, current + 1) for item in value)])
    return current


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        result = {"solverStatus": "solver_failed", "failureCode": "INPUT_TOO_LARGE", "retryable": False, "details": []}
    else:
        try:
            payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys, parse_constant=_reject_constant)
            if _depth(payload) > MAX_JSON_DEPTH:
                raise ValueError("JSON_DEPTH_EXCEEDED")
            result = solve_geometry(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            result = {"solverStatus": "solver_failed", "failureCode": str(error) or "INVALID_JSON", "retryable": False, "details": []}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
