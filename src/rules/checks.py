"""Generic, reusable check functions -- one per `logic.type` value in
ruleset.yaml. Each is dispatched by src/rules/engine.py based on the
rule's declared type; none of them know about a specific rule_id. Adding
a new rule that reuses one of these types requires zero new Python code.

Every check is computed ONCE, globally, across the full claims dataset
(not scoped to one provider) -- this is required for correctness on
cross-provider checks (interval_overlap, distinct_count) and is simply
efficient for the rest, since results are cached and later intersected
with a single provider's own claim IDs per request (see engine.py).

Each check returns a RuleComputation:
  - kind="claims": `claim_matches` is the full set of claim_ids (any
    provider) that satisfy the rule. n for a given provider = count of
    that provider's own claims in this set.
  - kind="groups": `groups` is a list of {claim_ids, providers} for every
    qualifying group (e.g. a beneficiary-day with 2+ distinct providers).
    n for a given provider = count of groups that provider participates
    in; matching_claim_ids = that provider's own claims within those
    groups. Used when the rule's summary counts groups, not claims
    (distinct_count, group_count) -- see ruleset.yaml's own wording.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

import pandas as pd

CLAIM_ID_COL = "ClaimID"
PROVIDER_COL = "Provider"


@dataclass
class RuleComputation:
    kind: str  # "claims" | "groups"
    claim_matches: set[str] = field(default_factory=set)
    groups: list[dict] = field(default_factory=list)  # [{"claim_ids": set[str], "providers": set[str]}]


_OPS = {
    "gte": lambda a, b: a >= b,
    "gt": lambda a, b: a > b,
    "lte": lambda a, b: a <= b,
    "lt": lambda a, b: a < b,
    "eq": lambda a, b: a == b,
}


def _apply_filter(df: pd.DataFrame, filt: dict | None) -> pd.DataFrame:
    if not filt:
        return df
    mask = pd.Series(True, index=df.index)
    for col, value in filt.items():
        mask &= df[col] == value
    return df[mask]


def check_date_compare(df: pd.DataFrame, logic: dict) -> RuleComputation:
    left, right, operator = logic["left"], logic["right"], logic["operator"]
    left_s, right_s = df[left], df[right]
    valid = left_s.notna() & right_s.notna()
    if operator == "after":
        mask = valid & (left_s > right_s)
    elif operator == "before":
        mask = valid & (left_s < right_s)
    else:
        raise ValueError(f"Unsupported date_compare operator: {operator}")
    return RuleComputation(kind="claims", claim_matches=set(df.loc[mask, CLAIM_ID_COL]))


def check_interval_overlap(df: pd.DataFrame, logic: dict) -> RuleComputation:
    group_by = logic["group_by"]
    start_col, end_col = logic["start"], logic["end"]
    scoped = _apply_filter(df, logic.get("filter"))
    scoped = scoped.dropna(subset=[start_col, end_col])

    counts = scoped.groupby(group_by)[CLAIM_ID_COL].transform("size")
    scoped = scoped[counts > 1]
    if scoped.empty:
        return RuleComputation(kind="claims", claim_matches=set())

    matches: set[str] = set()
    scoped = scoped.sort_values(by=group_by + [start_col])
    for _, group in scoped.groupby(group_by):
        rows = list(group[[CLAIM_ID_COL, start_col, end_col]].itertuples(index=False))
        n = len(rows)
        if n < 2:
            continue
        max_end = rows[0][2]
        max_end_id = rows[0][0]
        for i in range(1, n):
            cid, start, end = rows[i]
            if start < max_end:
                matches.add(cid)
                matches.add(max_end_id)
            if end > max_end:
                max_end = end
                max_end_id = cid
    return RuleComputation(kind="claims", claim_matches=matches)


def check_exact_duplicate(df: pd.DataFrame, logic: dict) -> RuleComputation:
    match_on = logic["match_on"]
    min_count = logic.get("min_count", 2)
    scoped = df.dropna(subset=match_on)
    sizes = scoped.groupby(match_on)[CLAIM_ID_COL].transform("size")
    mask = sizes >= min_count
    return RuleComputation(kind="claims", claim_matches=set(scoped.loc[mask, CLAIM_ID_COL]))


def check_distinct_count(df: pd.DataFrame, logic: dict) -> RuleComputation:
    group_by = logic["group_by"]
    count_col = logic["count_distinct"]
    operator, value = logic["operator"], logic["value"]
    op_fn = _OPS[operator]

    scoped = df.dropna(subset=group_by + [count_col])
    nunique = scoped.groupby(group_by)[count_col].transform("nunique")
    mask = op_fn(nunique, value)
    qualifying = scoped[mask]

    groups = [
        {"claim_ids": set(g[CLAIM_ID_COL]), "providers": set(g[PROVIDER_COL])}
        for _, g in qualifying.groupby(group_by)
    ]
    return RuleComputation(kind="groups", groups=groups)


def check_group_count(df: pd.DataFrame, logic: dict) -> RuleComputation:
    group_by = logic["group_by"]
    operator, value = logic["operator"], logic["value"]
    op_fn = _OPS[operator]

    scoped = df.dropna(subset=group_by)
    sizes = scoped.groupby(group_by)[CLAIM_ID_COL].transform("size")
    mask = op_fn(sizes, value)
    qualifying = scoped[mask]

    groups = [
        {"claim_ids": set(g[CLAIM_ID_COL]), "providers": set(g[PROVIDER_COL])}
        for _, g in qualifying.groupby(group_by)
    ]
    return RuleComputation(kind="groups", groups=groups)


def _eval_subcheck(df: pd.DataFrame, sub: dict) -> pd.Series:
    op_fn = _OPS[sub["operator"]]
    if sub["type"] == "date_diff":
        diff_days = (df[sub["end"]] - df[sub["start"]]).dt.days
        return diff_days.notna() & op_fn(diff_days, sub["value"])
    if sub["type"] == "numeric":
        col = df[sub["field"]]
        return col.notna() & op_fn(col, sub["value"])
    raise ValueError(f"Unsupported compound sub-check type: {sub['type']}")


def check_compound(df: pd.DataFrame, logic: dict) -> RuleComputation:
    scoped = _apply_filter(df, logic.get("filter"))
    mask = pd.Series(True, index=scoped.index)
    for sub in logic["all_of"]:
        mask &= _eval_subcheck(scoped, sub)
    return RuleComputation(kind="claims", claim_matches=set(scoped.loc[mask, CLAIM_ID_COL]))


CHECK_DISPATCH = {
    "date_compare": check_date_compare,
    "interval_overlap": check_interval_overlap,
    "exact_duplicate": check_exact_duplicate,
    "distinct_count": check_distinct_count,
    "group_count": check_group_count,
    "compound": check_compound,
}
