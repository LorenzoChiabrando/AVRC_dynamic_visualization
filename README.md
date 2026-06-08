# Metabolic Network Viewer

Interactive D3 views of an AGORA2 metabolic model (default: E. coli K-12 MG1655).
A small Python converter turns a COBRA `.mat` model into graph JSON, and the web
pages render that JSON in the browser. No build step and no backend.

## Layout

    converter/convert.py   converter from .mat to graph JSON
    data/raw/              raw COBRA .mat models
    web/                   browser pages (HTML, CSS, JS)
    web/data/              graph JSON read by the viewers

## Requirements

Python 3.11 with numpy and scipy:

    python3 -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt

## Convert a model

Default model (E. coli) to `web/data/graph.json`:

    python3 converter/convert.py

Reaction to reaction projection to `web/data/reactions.json`:

    python converter/convert.py --graph reaction

Every `.mat` in `data/raw/` to one JSON each, plus the `models.json` index that
fills the model dropdown:

    python3 converter/convert.py --all

## Run the viewer

Serve the `web` folder over HTTP and open it in a browser:

    python3 -m http.server 8000 --directory web

Pages:

    /                     organized view (subsystem blocks, isolated node view)
    /index-base.html      base bipartite view
    /reactions.html       reaction to reaction projection
