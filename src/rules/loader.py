"""Loads src/rules/ruleset.yaml into typed Rule objects.

Parsed once at startup (see src/rules/engine.py) -- never re-read per
request. Pure data loading, no pandas/claims logic here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_RULESET_PATH = Path(__file__).resolve().parent / "ruleset.yaml"

# Citations still marked "TODO ..." in the YAML must never leak to an API
# consumer as the literal placeholder text (see main task spec, item 4).
_TODO_PREFIX = "TODO"


@dataclass
class Rule:
    rule_id: str
    category: str
    severity: str
    citation: str | None  # None if the YAML citation was still "TODO ..."
    description: str
    scope: str  # "claim" | "beneficiary" | "provider"
    logic: dict[str, Any]
    summary_template: str
    notes: str = ""
    citation_is_todo: bool = False  # for reporting which rules still need a real citation

    @property
    def logic_type(self) -> str:
        return self.logic["type"]

    @property
    def requires(self) -> list[str]:
        return self.logic.get("requires", [])


def _clean_citation(raw: str | None) -> tuple[str | None, bool]:
    if raw is None:
        return None, True
    if raw.strip().upper().startswith(_TODO_PREFIX):
        return None, True
    return raw, False


def load_ruleset(path: Path | str = DEFAULT_RULESET_PATH) -> list[Rule]:
    """Parse ruleset.yaml into a list of Rule objects. Raises FileNotFoundError
    if the file is missing (caller decides how to degrade -- see engine.py)."""
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        doc = yaml.safe_load(f)

    rules = []
    for entry in doc.get("rules", []):
        citation, is_todo = _clean_citation(entry.get("citation"))
        rules.append(
            Rule(
                rule_id=entry["rule_id"],
                category=entry["category"],
                severity=entry["severity"],
                citation=citation,
                citation_is_todo=is_todo,
                description=(entry.get("description") or "").strip(),
                scope=entry["scope"],
                logic=entry["logic"],
                summary_template=(entry.get("summary_template") or "").strip(),
                notes=(entry.get("notes") or "").strip(),
            )
        )
    return rules
