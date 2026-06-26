"""Batch conversion: every .mat in a folder, plus the models.json manifest."""
from __future__ import annotations

import json
from pathlib import Path

from cobra_io import DEFAULT_OUT_DIR, MANIFEST_NAME, load_model, model_label
from graphs import build_payload, build_reaction_payload


def convert_folder(src_dir, out_dir=DEFAULT_OUT_DIR, *, drop_currency: bool = False) -> dict:
    """Convert every .mat in src_dir to a bipartite JSON and write models.json.

    Each model becomes out_dir/<stem>.json plus its reaction projection
    out_dir/<stem>.reactions.json, and an index models.json that the viewer reads.
    A model that fails to load is skipped with a warning.
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
        # Reaction projection of the SAME model, next to the bipartite.
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
