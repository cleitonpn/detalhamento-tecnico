import { analyzeSurfaceSections } from "./sections.js";
self.onmessage = ({ data }) => {
  try {
    const profile = analyzeSurfaceSections(data.triangles, data.dimensions);
    self.postMessage({ result: { surfaceSections: profile, arcs: [], views: { top: {} }, curves: [], freeCurves: 0 } });
  } catch (e) { self.postMessage({ error: e.message }); }
};
