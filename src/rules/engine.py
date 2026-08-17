"""RuleEngine: loads ruleset.yaml, precomputes every enabled rule ONCE
across the full (cross-provider) claims dataset at startup, then answers
per-provider evidence queries via fast set-intersections against a
cached, pre-grouped index -- no re-scanning the 558k-row dataset per
request (see checks.py's module docstring for why global precomputation
is required, not just an optimization, for cross-provider rules).

Owns its own module-level state, mirroring src/api/auth.py and
src/api/claims.py -- main.py's lifespan builds one RuleEngine at startup
and hands it here via set_engine().
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from src.rules.checks import CHECK_DISPATCH, PROVIDER_COL, CLAIM_ID_COL
from src.rules.loader import Rule, load_ruleset

logger = logging.getLogger("rules_engine")

DUPLICATE_CLAIM_FIRE_RATE_WARN_THRESHOLD = 0.20


class RuleEngine:
    def __init__(self, claims_df: pd.DataFrame, rules: list[Rule]):
        self.claims_df = claims_df
        self.enabled_rules: list[Rule] = []
        self.disabled_rules: list[tuple[Rule, str]] = []
        self._computations: dict[str, object] = {}
        pids = claims_df[PROVIDER_COL].values
        cids = claims_df[CLAIM_ID_COL].values
        provider_claim_ids: dict[str, set[str]] = {}
        for p, c in zip(pids, cids):
            if p not in provider_claim_ids:
                provider_claim_ids[p] = set()
            provider_claim_ids[p].add(c)
        self._provider_claim_ids = provider_claim_ids
        self._evidence_cache: dict[str, dict] = {}
        self._build(rules)

    def _build(self, rules: list[Rule]) -> None:
        for rule in rules:
            missing = [f for f in rule.requires if f not in self.claims_df.columns]
            if missing:
                reason = f"missing required field(s): {missing}"
                self.disabled_rules.append((rule, reason))
                logger.warning("Rule %s disabled: %s", rule.rule_id, reason)
                continue

            check_fn = CHECK_DISPATCH.get(rule.logic_type)
            if check_fn is None:
                reason = f"unsupported logic.type: {rule.logic_type!r}"
                self.disabled_rules.append((rule, reason))
                logger.warning("Rule %s disabled: %s", rule.rule_id, reason)
                continue

            try:
                computation = check_fn(self.claims_df, rule.logic)
            except Exception as exc:  # a bad/unexpected rule definition must not crash startup
                reason = f"error during evaluation: {exc}"
                self.disabled_rules.append((rule, reason))
                logger.warning("Rule %s disabled: %s", rule.rule_id, reason)
                continue

            self.enabled_rules.append(rule)
            self._computations[rule.rule_id] = computation

    def provider_exists(self, provider_id: str) -> bool:
        return provider_id in self._provider_claim_ids

    def evidence_for_provider(self, provider_id: str) -> dict:
        """Cached per provider_id (requirement: don't re-run rules on every
        paginated claims request or repeated /evidence calls)."""
        if provider_id in self._evidence_cache:
            return self._evidence_cache[provider_id]

        provider_claim_ids = self._provider_claim_ids.get(provider_id, set())
        findings = []

        for rule in self.enabled_rules:
            computation = self._computations[rule.rule_id]

            if computation.kind == "claims":
                matching = computation.claim_matches & provider_claim_ids
                n = len(matching)
            else:  # "groups" -- n counts qualifying groups, not claims (see checks.py docstring)
                relevant_groups = [g for g in computation.groups if provider_id in g["providers"]]
                n = len(relevant_groups)
                matching = set()
                for g in relevant_groups:
                    matching |= g["claim_ids"] & provider_claim_ids

            if n == 0:
                continue

            findings.append(
                {
                    "type": "rule",
                    "rule_id": rule.rule_id,
                    "category": rule.category,
                    "severity": rule.severity,
                    "citation": rule.citation,  # already None if YAML had a TODO placeholder
                    "summary": rule.summary_template.format(n=n),
                    "matching_claim_ids": sorted(matching),
                }
            )

        result = {
            "provider_id": provider_id,
            "rules_evaluated": len(self.enabled_rules),
            "rules_fired": len(findings),
            "findings": findings,
        }
        self._evidence_cache[provider_id] = result
        return result

    def rule_flags_for_claims(self, provider_id: str) -> dict[str, list[dict]]:
        """claim_id -> [{"rule_id", "severity"}, ...] for this provider's own
        claims, derived from the (cached) evidence result above."""
        evidence = self.evidence_for_provider(provider_id)
        flags: dict[str, list[dict]] = {}
        for finding in evidence["findings"]:
            for claim_id in finding["matching_claim_ids"]:
                flags.setdefault(claim_id, []).append(
                    {"rule_id": finding["rule_id"], "severity": finding["severity"]}
                )
        return flags

    def rule_fire_rate(self, rule_id: str) -> float | None:
        """Fraction of providers (with >=1 claim) this rule fires for. Used
        for the DUPLICATE_CLAIM sanity check and general startup diagnostics."""
        computation = self._computations.get(rule_id)
        if computation is None:
            return None
        total_providers = len(self._provider_claim_ids)
        if total_providers == 0:
            return 0.0

        if computation.kind == "claims":
            hit_mask = self.claims_df[CLAIM_ID_COL].isin(computation.claim_matches)
            providers_hit = set(self.claims_df.loc[hit_mask, PROVIDER_COL])
        else:
            providers_hit = set()
            for g in computation.groups:
                providers_hit |= g["providers"]

        return len(providers_hit) / total_providers


def build_engine(claims_df: pd.DataFrame, ruleset_path: Path | str | None = None) -> RuleEngine:
    rules = load_ruleset(ruleset_path) if ruleset_path else load_ruleset()
    engine = RuleEngine(claims_df, rules)

    logger.info(
        "Rule engine built: %d enabled, %d disabled",
        len(engine.enabled_rules),
        len(engine.disabled_rules),
    )
    for rule, reason in engine.disabled_rules:
        logger.warning("  disabled: %s (%s)", rule.rule_id, reason)

    dup_rate = engine.rule_fire_rate("DUPLICATE_CLAIM")
    if dup_rate is not None:
        pct = dup_rate * 100
        level = logger.warning if dup_rate > DUPLICATE_CLAIM_FIRE_RATE_WARN_THRESHOLD else logger.info
        level("DUPLICATE_CLAIM fires on %.1f%% of providers", pct)

    return engine


_state: dict = {}


def set_engine(engine: RuleEngine) -> None:
    _state["engine"] = engine


def get_engine() -> RuleEngine | None:
    return _state.get("engine")
