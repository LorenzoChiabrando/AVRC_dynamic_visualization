"""Convert a COBRA/AGORA .mat model into D3 graph JSON (command-line entry point).

Two graph kinds come from the stoichiometric matrix S:
  bipartite: metabolite/reaction graph, written to web/data/graph.json
  reaction:  reaction to reaction projection, written to web/data/reactions.json

Edge direction in the bipartite graph follows the sign of S: a negative coefficient
means the metabolite is a substrate (edge from metabolite to reaction), a positive one
means it is a product (edge from reaction to metabolite).

The work lives in the sibling modules: cobra_io (loading and helpers), graphs (the two
payload builders) and batch (folder conversion plus the manifest).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from cobra_io import (DEFAULT_MODEL, DEFAULT_OUT, DEFAULT_OUT_DIR,
                      DEFAULT_OUT_REACTION, DEFAULT_RAW_DIR, load_model)
from graphs import build_payload, build_reaction_payload
from batch import convert_folder


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
