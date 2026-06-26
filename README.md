# Metabolic Network Viewer

Interactive D3 views of an AGORA2 metabolic model (default: E. coli K-12 MG1655).
A small Python converter turns a COBRA `.mat` model into graph JSON, and the web
pages render that JSON in the browser. No build step and no backend.

## Layout

    converter/             .mat to graph JSON: convert.py (CLI) + cobra_io, graphs, batch
    data/raw/              raw COBRA .mat models
    web/index.html         the single page: organized view + reaction-projection toggle
    web/js/                ES modules: config, util, data/, core/, views/
    web/css/               viewer.css plus the MINEBUGS theme
    web/data/              graph JSON read by the viewer

## Run the viewer

The graph JSON in `web/data/` is already generated, so you can start right away.
Serve the `web` folder and open it in a browser. This needs no extra packages,
`http.server` is part of the standard library:

    python3 -m http.server 8000 --directory web

Then open the pages:

    http://localhost:8000/                  organized view (subsystem blocks, isolated node view);
                                            "Search & view" toggles the reaction-reaction projection

## Regenerate the data (optional)

Only needed to rebuild the JSON or add a model. Create a virtual environment and
activate it, so plain `python` points at it instead of the system one (that is the
usual cause of a "No module named scipy" error):

    python3 -m venv .venv
    source .venv/bin/activate          # Windows: .venv\Scripts\activate
    pip install -r requirements.txt

With the environment active:

    python converter/convert.py                   # default model to web/data/graph.json
    python converter/convert.py --graph reaction  # projection to web/data/reactions.json
    python converter/convert.py --all             # every .mat in data/raw/ plus models.json

If you would rather not activate, call the venv Python directly:

    .venv/bin/python converter/convert.py

Needs Python 3.11 or newer with numpy and scipy.
