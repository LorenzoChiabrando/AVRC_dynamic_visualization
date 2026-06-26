// Read models.json, fill the model dropdown, and choose which dataset to load.
// The choice is kept in sessionStorage; changing the dropdown reloads the page.
const SS_MODEL = "organized.model";

// Pure: pick the model file (saved choice if still valid, else default, else first).
export function chooseModelFile(manifest, saved) {
  const models = (manifest && Array.isArray(manifest.models)) ? manifest.models : [];
  if (!models.length) throw new Error("empty manifest");
  const valid = new Set(models.map((m) => m.file));
  return (saved && valid.has(saved)) ? saved : (manifest.default || models[0].file);
}

// Pure: the data file to load. Bipartite loads the model file itself; the projection
// loads that model's reaction file.
export function dataFile(manifest, modelFile, view) {
  if (view !== "projection") return modelFile;
  const entry = manifest.models.find((m) => m.file === modelFile) || manifest.models[0];
  return entry.reactions || "reactions.json";
}

// Fill the dropdown, wire model changes, and return the data file to load. Falls back
// to the historic E. coli file when models.json is missing.
export function resolveDataset(view) {
  const selEl = document.getElementById("model-select");
  return d3.json("data/models.json").then((manifest) => {
    const models = (manifest && Array.isArray(manifest.models)) ? manifest.models : [];
    if (!models.length) throw new Error("empty manifest");
    if (selEl) models.forEach((m) => addModelOption(selEl, m.file, m.label));
    const modelFile = chooseModelFile(manifest, sessionStorage.getItem(SS_MODEL));
    if (selEl) {
      selEl.value = modelFile;
      selEl.addEventListener("change", () => {
        sessionStorage.setItem(SS_MODEL, selEl.value);
        location.reload();
      });
    }
    return dataFile(manifest, modelFile, view);
  }).catch(() => (view === "projection") ? "reactions.json" : "graph.json");
}

function addModelOption(selEl, file, label) {
  const o = document.createElement("option");
  o.value = file;
  o.textContent = label || file;
  selEl.appendChild(o);
}
