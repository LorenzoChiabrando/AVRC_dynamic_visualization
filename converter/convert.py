"""Convert a COBRA/AGORA .mat model into D3 graph JSON.

Two graph kinds come from the stoichiometric matrix S:
  bipartite: metabolite/reaction graph, written to web/data/graph.json
  reaction:  reaction to reaction projection, written to web/data/reactions.json

Edge direction in the bipartite graph follows the sign of S. A negative
coefficient means the metabolite is a substrate (edge from metabolite to
reaction); a positive one means it is a product (edge from reaction to metabolite).
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy.io


# Currency metabolites (atp, water, and so on) appear almost everywhere. In the
# reaction projection they would link nearly every reaction, so we can drop them.
CURRENCY_PATTERNS = (
    "atp", "adp", "amp", "nadh", "nadph", "nadp", "nad",
    "coa", "h2o", "h[", "pi[", "ppi", "co2", "o2", "nh4", "hco3",
)

# Paths are taken from this file so the script runs from any working directory.
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_RAW_DIR = SCRIPT_DIR.parent / "data" / "raw"
DEFAULT_MODEL = DEFAULT_RAW_DIR / "Escherichia_coli_str_K_12_substr_MG1655.mat"
DEFAULT_OUT = SCRIPT_DIR.parent / "web" / "data" / "graph.json"
DEFAULT_OUT_REACTION = SCRIPT_DIR.parent / "web" / "data" / "reactions.json"
DEFAULT_OUT_DIR = DEFAULT_OUT.parent
MANIFEST_NAME = "models.json"


def is_currency(met_id: str) -> bool:
    mid = str(met_id).lower()
    return any(p in mid for p in CURRENCY_PATTERNS)


def get_compartment(met_id: str) -> str:
    # AGORA ids keep the compartment in brackets, e.g. "atp[c]" gives "c".
    mid = str(met_id)
    if mid.endswith("]") and "[" in mid:
        return mid[mid.rfind("[") + 1: -1]
    return "unknown"


def _norm_subsystem(value) -> str:
    # A subSystems entry can be a string, a list or a numpy array.
    if isinstance(value, (list, tuple, np.ndarray)):
        value = value[0] if len(value) else ""
    text = str(value).strip()
    return text if text else "Unknown"


def _as_list(value) -> list:
    # Optional fields may be missing, scalar, a list or a numpy array.
    if value is None:
        return []
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def model_label(stem: str) -> str:
    # AGORA2 file names use underscores in place of spaces.
    return stem.replace("_", " ").strip()


def load_model(mat_path: str | Path) -> dict:
    mat_path = Path(mat_path)
    if not mat_path.exists():
        raise FileNotFoundError(f"Model file not found: {mat_path}")
    raw = scipy.io.loadmat(str(mat_path), simplify_cells=True)
    # loadmat adds technical keys like "__header__"; keep the first real one.
    model_keys = [k for k in raw if not k.startswith("_")]
    if not model_keys:
        raise ValueError("No model key found in .mat file.")
    return raw[model_keys[0]]


def build_payload(model: dict, *, drop_currency: bool = False) -> dict:
    """Build the {nodes, links} payload for the directed bipartite graph."""
    # S, mets and rxns are required. A clear error lets batch mode skip a bad model.
    for key in ("S", "mets", "rxns"):
        if key not in model:
            raise KeyError(f"Model missing required field '{key}'")

    S = model["S"]
    if hasattr(S, "toarray"):  # densify if the matrix is sparse
        S = S.toarray()
    S = np.asarray(S, dtype=np.float64)

    mets = [str(m) for m in model["mets"]]
    rxns = [str(r) for r in model["rxns"]]
    # Optional fields fall back to the id, "Unknown" or lb=0 when absent.
    metnames = [str(m) for m in _as_list(model.get("metNames"))]
    rxnnames = [str(r) for r in _as_list(model.get("rxnNames"))]
    raw_subsys = _as_list(model.get("subSystems"))
    lb_raw = model.get("lb")  # lower bound; lb < 0 marks a reversible reaction
    lb = np.asarray(lb_raw, dtype=np.float64) if lb_raw is not None else np.zeros(len(rxns))

    currency = [is_currency(m) for m in mets]
    keep_met = [True] * len(mets)
    if drop_currency:
        keep_met = [not c for c in currency]

    met_degree = [0] * len(mets)
    rxn_degree = [0] * len(rxns)

    # One edge per nonzero entry of S, directed by the sign of the coefficient.
    links = []
    rows, cols = np.nonzero(S)
    for i, j in zip(rows.tolist(), cols.tolist()):
        if not keep_met[i]:
            continue
        coef = float(S[i, j])
        met_node = f"M_{mets[i]}"
        rxn_node = f"R_{rxns[j]}"
        if coef < 0:  # substrate: metabolite goes into the reaction
            links.append({"source": met_node, "target": rxn_node, "stoichiometry": abs(coef)})
        else:  # product: the reaction makes the metabolite
            links.append({"source": rxn_node, "target": met_node, "stoichiometry": coef})
        met_degree[i] += 1
        rxn_degree[j] += 1

    nodes = []
    for i, mid in enumerate(mets):
        if not keep_met[i]:
            continue
        nodes.append({
            "id": f"M_{mid}",
            "kind": "metabolite",
            "name": metnames[i] if i < len(metnames) else mid,
            "compartment": get_compartment(mid),
            "currency": bool(currency[i]),
            "degree": met_degree[i],
        })
    for j, rid in enumerate(rxns):
        nodes.append({
            "id": f"R_{rid}",
            "kind": "reaction",
            "name": rxnnames[j] if j < len(rxnnames) else rid,
            "subsystem": _norm_subsystem(raw_subsys[j]) if j < len(raw_subsys) else "Unknown",
            "reversible": bool(j < len(lb) and lb[j] < 0),
            "degree": rxn_degree[j],
        })

    return {"nodes": nodes, "links": links}


def build_reaction_payload(model: dict) -> dict:
    """Build the {nodes, links} payload for the producer to consumer projection.

    For each non currency metabolite, link every producer reaction (S > 0) to
    every consumer reaction (S < 0). Edge weight is the count of shared metabolites.
    """
    S = model["S"]
    if hasattr(S, "toarray"):
        S = S.toarray()
    S = np.asarray(S, dtype=np.float64)

    mets = [str(m) for m in model["mets"]]
    rxns = [str(r) for r in model["rxns"]]
    rxnnames = [str(r) for r in model["rxnNames"]]
    raw_subsys = model["subSystems"]
    lb = np.asarray(model["lb"], dtype=np.float64)

    keep = [i for i, m in enumerate(mets) if not is_currency(m)]

    edge_w: dict[tuple[int, int], int] = defaultdict(int)
    for m in keep:
        row = S[m, :]
        producers = np.where(row > 0)[0]
        consumers = np.where(row < 0)[0]
        if producers.size == 0 or consumers.size == 0:
            continue
        for a in producers.tolist():
            for c in consumers.tolist():
                if a != c:  # skip self loops
                    edge_w[(a, c)] += 1

    degree = [0] * len(rxns)
    links = []
    for (a, b), w in edge_w.items():
        links.append({"source": f"R_{rxns[a]}", "target": f"R_{rxns[b]}", "weight": int(w)})
        degree[a] += 1
        degree[b] += 1

    nodes = [
        {
            "id": f"R_{rid}",
            "kind": "reaction",
            "name": rxnnames[j] if j < len(rxnnames) else rid,
            "subsystem": _norm_subsystem(raw_subsys[j]) if j < len(raw_subsys) else "Unknown",
            "reversible": bool(lb[j] < 0),
            "degree": degree[j],
        }
        for j, rid in enumerate(rxns)
    ]
    return {"nodes": nodes, "links": links}


def convert_folder(src_dir: str | Path, out_dir: str | Path = DEFAULT_OUT_DIR,
                   *, drop_currency: bool = False) -> dict:
    """Convert every .mat in src_dir to a bipartite JSON and write models.json.

    Each model becomes out_dir/<stem>.json, plus an index models.json that the
    viewer dropdown reads. A model that fails to load is skipped with a warning.
    """
    src_dir = Path(src_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    mat_files = sorted(src_dir.glob("*.mat"))
    if not mat_files:
        raise FileNotFoundError(f"No .mat files found in {src_dir}")

    entries = []
    for mat in mat_files:
        try:
            model = load_model(mat)
            payload = build_payload(model, drop_currency=drop_currency)  # bipartite
            rpayload = build_reaction_payload(model)                     # directed reaction projection
        except Exception as exc:  # skip a broken model, keep converting the rest
            print(f"[skip] {mat.name}: {exc}")
            continue
        out_file = out_dir / (mat.stem + ".json")
        with out_file.open("w") as f:
            json.dump(payload, f)
        # Reaction projection of the SAME model, next to the bipartite: <stem>.reactions.json.
        # Lets the bipartite viewer switch to the projection of the current model.
        rxn_file = out_dir / (mat.stem + ".reactions.json")
        with rxn_file.open("w") as f:
            json.dump(rpayload, f)
        entries.append({
            "file": out_file.name,
            "reactions": rxn_file.name,   # projection file for this model (data/<file>)
            "label": model_label(mat.stem),
            "nodes": len(payload["nodes"]),
            "links": len(payload["links"]),
        })
        print(f"[all] {mat.name}: {len(payload['nodes'])} nodes, {len(payload['links'])} links -> {out_file.name} (+ {rxn_file.name})")

    entries.sort(key=lambda e: e["label"].lower())

    # Default to E. coli when present, otherwise the first model.
    default = next((e["file"] for e in entries if "escherichia" in e["label"].lower()), None)
    if default is None and entries:
        default = entries[0]["file"]

    manifest = {"models": entries, "default": default}
    manifest_path = out_dir / MANIFEST_NAME
    with manifest_path.open("w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[all] wrote manifest with {len(entries)} model(s) -> {manifest_path}")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a COBRA .mat model to a D3 graph JSON")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="Path to the .mat model file")
    parser.add_argument("--graph", choices=["bipartite", "reaction"], default="bipartite",
                        help="bipartite metabolite/reaction graph (default) or reaction projection")
    parser.add_argument("--out", type=Path, default=None,
                        help="output JSON path (default web/data/graph.json, or reactions.json for the reaction graph)")
    parser.add_argument("--drop-currency", action="store_true",
                        help="drop currency metabolites (bipartite only; the projection always drops them)")
    parser.add_argument("--all", nargs="?", const=str(DEFAULT_RAW_DIR), default=None, metavar="DIR",
                        help="batch mode: convert every .mat in DIR (default data/raw) and write models.json")
    args = parser.parse_args()

    # Batch mode ignores --graph, --model and --out.
    if args.all is not None:
        convert_folder(args.all, DEFAULT_OUT_DIR, drop_currency=args.drop_currency)
        return

    model = load_model(args.model)

    if args.graph == "reaction":
        payload = build_reaction_payload(model)
        out = args.out or DEFAULT_OUT_REACTION
    else:
        payload = build_payload(model, drop_currency=args.drop_currency)
        out = args.out or DEFAULT_OUT

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        json.dump(payload, f)
    print(f"[{args.graph}] wrote {len(payload['nodes'])} nodes, {len(payload['links'])} links -> {out}")


if __name__ == "__main__":
    main()
