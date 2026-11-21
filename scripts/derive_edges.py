from pathlib import Path
import json
import math

PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
NODES_PATH = PROJECT_DIR / "data" / "nodes_raw.json"
TOPO_PATH = PROJECT_DIR / "data" / "branch_topology.json"
OVERRIDES_PATH = PROJECT_DIR / "data" / "edge_overrides.json"
OUT_EDGES = PROJECT_DIR / "data" / "edges.json"


def dist(p1, p2) -> float:
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def main() -> None:
    nodes_list = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in nodes_list}
    topo = json.loads(TOPO_PATH.read_text(encoding="utf-8"))
    branches = {b["id"]: b for b in topo["branches"]}

    if not OVERRIDES_PATH.exists():
        OVERRIDES_PATH.write_text("{}", encoding="utf-8")
    overrides = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))

    # Group assigned nodes by branch, sorted by dist_from_base
    by_br = {bid: [] for bid in branches}
    for nid, info in topo["node_assignments"].items():
        by_br[info["primary_branch"]].append((info["dist_from_base"], nid))
    for bid in by_br:
        by_br[bid].sort()

    edges: dict[str, str | None] = {}

    # 1. Fixed ancestors A01..A11 and Root R00 and Tier-1 B01..B08
    edges["A01"] = None
    for i in range(2, 12):
        edges[f"A{i:02d}"] = f"A{i-1:02d}"
    edges["R00"] = "A11"
    for i in range(1, 9):
        edges[f"B{i:02d}"] = "R00"

    # Special handling for BR_TRUNK nodes above B08 (ماضي)
    # On BR_TRUNK: R00, B08, Y01, M025, M018, M001, L001
    for _, nid in by_br["BR_TRUNK"]:
        if nid in ("R00", "B08"):
            continue
        if nid == "L001":
            edges[nid] = "M001"
        else:
            edges[nid] = "B08"

    # Topological order of branches from BR_TRUNK outward
    children_br = {bid: [] for bid in branches}
    for bid, b in branches.items():
        pb = b["parent_branch"]
        if pb:
            children_br[pb].append(bid)

    branch_owner: dict[str, str] = {"BR_TRUNK": "B08"}
    queue = list(children_br["BR_TRUNK"])

    while queue:
        bid = queue.pop(0)
        b = branches[bid]
        pb = b["parent_branch"]
        bp = b["base_point"]

        # Determine parent node on pb that spawns this branch bid
        if pb == "BR_TRUNK":
            # Check if a trunk node sits right near bp (within 40pt)
            trunk_cands = []
            for _, pnid in by_br["BR_TRUNK"]:
                if pnid == "R00" or nodes[pnid]["tier"] == "tier4_leaf":
                    continue
                pn = nodes[pnid]
                d = dist((pn["cx"], pn["cy"]), bp)
                if d <= 45 and pn["cy"] >= bp[1] - 20:
                    trunk_cands.append((d, pnid))
            if trunk_cands and not any(nodes[nid]["tier"] == "tier1_son" for _, nid in by_br[bid]):
                trunk_cands.sort()
                base_owner = trunk_cands[0][1]
            elif any(nodes[nid]["tier"] == "tier1_son" for _, nid in by_br[bid]):
                base_owner = "R00"
            else:
                base_owner = "B08"
        else:
            # On parent branch pb, find non-leaf node on pb closest to bp (preferring upstream or at junction)
            pb_nonleaf = [(d, nid) for d, nid in by_br[pb] if nodes[nid]["tier"] != "tier4_leaf"]
            if pb_nonleaf:
                best = None
                for d_on_pb, nid in pb_nonleaf:
                    n = nodes[nid]
                    # Prefer nodes on pb within 45pt of bp, else nearest upstream non-leaf on pb
                    d_to_bp = dist((n["cx"], n["cy"]), bp)
                    # Estimate bp distance from pb's base_point
                    pb_bp = branches[pb]["base_point"]
                    bp_d_on_pb = dist(bp, pb_bp)
                    upstream_ok = d_on_pb <= bp_d_on_pb + 30
                    score = (0 if d_to_bp <= 42 else (1 if upstream_ok else 2), d_to_bp)
                    if best is None or score < best[0]:
                        best = (score, nid)
                base_owner = best[1]
            else:
                base_owner = branch_owner[pb]

        # Now assign all nodes on bid
        items = by_br[bid]
        nonleaf_items = [(d, nid) for d, nid in items if nodes[nid]["tier"] != "tier4_leaf"]

        # If first non-leaf sits near base of branch (d < 130) or branch starts with tier1/tier2
        head_nid = None
        if nonleaf_items:
            first_d, first_nid = nonleaf_items[0]
            if first_d <= 125 or nodes[first_nid]["tier"] in ("tier1_son", "tier2_yellow"):
                head_nid = first_nid

        branch_owner[bid] = head_nid if head_nid else base_owner

        # Assign non-leaf nodes on bid
        for idx_nl, (d_nl, nid) in enumerate(nonleaf_items):
            if nid in edges:
                continue
            if idx_nl == 0 and nid == head_nid:
                edges[nid] = base_owner
            else:
                # Subsequent non-leaf along this branch is child of head_nid (sibling spine)
                edges[nid] = branch_owner[bid]

        # Assign leaf nodes on bid to nearest preceding non-leaf on bid (or branch_owner)
        for d_l, nid in items:
            if nid in edges or nodes[nid]["tier"] != "tier4_leaf":
                continue
            preceding = [nl_nid for d_nl, nl_nid in nonleaf_items if d_nl <= d_l + 8]
            if preceding:
                edges[nid] = preceding[-1]
            else:
                edges[nid] = branch_owner[bid]

        queue.extend(children_br[bid])

    # Apply explicit visual-audit overrides
    for cid, pid in overrides.items():
        if cid.startswith("_"):
            continue
        edges[cid] = pid

    # Ensure every single node from nodes_raw.json is present
    missing = [n["id"] for n in nodes_list if n["id"] not in edges]
    assert not missing, f"Missing edges for: {missing}"

    OUT_EDGES.write_text(json.dumps(edges, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(edges)} edges to {OUT_EDGES} (overrides applied: {len([k for k in overrides if not k.startswith('_')])})")


if __name__ == "__main__":
    main()
