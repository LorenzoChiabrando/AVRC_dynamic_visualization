// Entry point for the organized and projection views. Reads the view flag, loads the
// dataset, builds the shared ctx, wires the modules onto it and runs the startup.
import { PROFILE } from "./config.js";
import { resolveDataset } from "./data/manifest.js";
import { loadGraph } from "./data/graph.js";
import { createContext } from "./core/context.js";
import { createScales } from "./core/scales.js";
import { createRender } from "./core/render.js";
import { createLabels } from "./core/labels.js";
import { createSettle } from "./core/settle.js";
import { createZoom } from "./core/zoom.js";
import { createInfo } from "./core/info.js";
import { createSelection } from "./core/selection.js";
import { createLegend } from "./core/legend.js";
import { createSearch } from "./core/search.js";
import { createIsolated } from "./core/isolated.js";
import { layoutOrganized } from "./views/layout-organized.js";
import { createCommunity } from "./views/community.js";
import { wire } from "./views/wire.js";

const view = sessionStorage.getItem("organized.view") === "projection" ? "projection" : "organized";

resolveDataset(view)
  .then((file) => loadGraph(file, PROFILE[view].TOP_LABELS))
  .then((graph) => {
    const ctx = createContext({ view, graph });
    // Order matters: a module may read another's result at creation time.
    ctx.scales = createScales(ctx.nodes, ctx.profile);
    ctx.render = createRender(ctx);
    ctx.labels = createLabels(ctx);
    ctx.settle = createSettle(ctx);
    ctx.zoomCtl = createZoom(ctx);
    ctx.info = createInfo(ctx);
    ctx.select = createSelection(ctx);
    ctx.legend = createLegend(ctx);
    ctx.search = createSearch(ctx);
    ctx.layout = layoutOrganized(ctx);     // sets ctx.sim and ctx.organized.subRxns
    ctx.community = createCommunity(ctx);   // reads ctx.organized.subRxns
    ctx.isolated = createIsolated(ctx);     // reads ctx.layers.glabelG

    // Startup: paint once, settle the layout, then wire the controls.
    ctx.render.applyCurrency();
    ctx.legend.renderLegend();
    ctx.layout.run(() => {
      ctx.render.positionAll();
      ctx.labels.applyLabels();
      ctx.layout.renderGroupLabels();
      ctx.sel.node.call(ctx.drag);
      wire(ctx, { layout: ctx.layout });
      ctx.search.wireSearch();
      ctx.zoomCtl.fitView(false);
      ctx.overlay.hide();
    });
  })
  .catch((err) => console.error("Failed to load the dataset.", err));
