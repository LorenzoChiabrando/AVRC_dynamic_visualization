"""Build the D3 graph payloads from a COBRA model.

The bipartite payload keeps metabolite and reaction nodes with edges directed by the
sign of S; the reaction payload projects to a producer-to-consumer reaction graph.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from cobra_io import densify, is_currency, get_compartment, _norm_subsystem, _as_list


def build_payload(model: dict, *, drop_currency: bool = False) -> dict:
    """Build the {nodes, links} payload for the directed bipartite graph."""
    # S, mets and rxns are required. A clear error lets batch mode skip a bad model.
    for key in ("S", "mets", "rxns"):
        if key not in model:
            raise KeyError(f"Model missing required field '{key}'")

    S = densify(model["S"])
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

    For each non currency metabolite, link every producer reaction (S > 0) to every
    consumer reaction (S < 0). Edge weight is the count of shared metabolites.
    """
    S = densify(model["S"])
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
