"""Loading and shared helpers for the COBRA/AGORA .mat converter."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import scipy.io

# Paths are taken from this file so the script runs from any working directory.
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_RAW_DIR = SCRIPT_DIR.parent / "data" / "raw"
DEFAULT_MODEL = DEFAULT_RAW_DIR / "Escherichia_coli_str_K_12_substr_MG1655.mat"
DEFAULT_OUT = SCRIPT_DIR.parent / "web" / "data" / "graph.json"
DEFAULT_OUT_REACTION = SCRIPT_DIR.parent / "web" / "data" / "reactions.json"
DEFAULT_OUT_DIR = DEFAULT_OUT.parent
MANIFEST_NAME = "models.json"

# Currency metabolites (atp, water, and so on) appear almost everywhere. In the
# reaction projection they would link nearly every reaction, so we can drop them.
CURRENCY_PATTERNS = (
    "atp", "adp", "amp", "nadh", "nadph", "nadp", "nad",
    "coa", "h2o", "h[", "pi[", "ppi", "co2", "o2", "nh4", "hco3",
)


def is_currency(met_id) -> bool:
    mid = str(met_id).lower()
    return any(p in mid for p in CURRENCY_PATTERNS)


def get_compartment(met_id) -> str:
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


def load_model(mat_path) -> dict:
    mat_path = Path(mat_path)
    if not mat_path.exists():
        raise FileNotFoundError(f"Model file not found: {mat_path}")
    raw = scipy.io.loadmat(str(mat_path), simplify_cells=True)
    # loadmat adds technical keys like "__header__"; keep the first real one.
    model_keys = [k for k in raw if not k.startswith("_")]
    if not model_keys:
        raise ValueError("No model key found in .mat file.")
    return raw[model_keys[0]]


def densify(S):
    """Return S as a dense float64 ndarray (COBRA matrices are often sparse)."""
    if hasattr(S, "toarray"):
        S = S.toarray()
    return np.asarray(S, dtype=np.float64)
