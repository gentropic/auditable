// micro shared mutable state. One S object imported by every module — ES module
// bindings can't be reassigned across modules, so cross-module state lives as
// S.* properties (same pattern as auditable's src/js/state.js).
//
// Only state that more than one module reads belongs here. Transient
// single-function locals (dialog handles, gesture state) stay where they live.
export const S = {
  // ── layers (micro-layers spec §1): each opened dataset is a layer — its docs,
  // bbox, view state (color/clip/filter), and visibility. The renderer partitions
  // record ids (layer << 29 | record), so picks resolve to the right source.
  layers: [],
  activeId: 0,
  layerTree: [],                                            // tree nodes: layer refs + groups (persisted in project.json)

  // ── project (File menu): the open project folder, bookmarks, scenes
  project: null,                                            // { dir: FileSystemDirectoryHandle, name, dirty }
  crs: null,                                                // the project's coordinate system — a @gcu/proj CRS object (src/crs.js), saved in project.json
  crsWhy: null,                                             // how it was set: 'picked' | 'from <file>' | 'project'
  hasFSAA: false,                                           // project folders can be picked + written here (the File System Access API; inside the lead-acid shell, its tree plugin's answer)
  views: [],                                                // bookmarks (viewpoints): { name, camera, section, file? }
  scenes: [],                                               // scenes (full working state): { name, camera, section, layers:[…], file? }

  // ── recipes (Tools → Recipes): op-shaped YAML files in recipes/
  recipes: [],                                              // { name, tool, params, file }
  house: { props: {} },                                     // the project's house style: shared properties (figures/house.json)
  figures: [],                                              // composer figures (compo documents): { name, doc, file } — figures/<slug>.compo.json

  // ── long-lived app objects, assigned once at boot (the app module creates
  // them; modules that need them read them here)
  renderer: null,
  cam: null,                                                // the orbit camera
  cv: null,                                                 // the 3D canvas element
  build: 'dev',                                             // the build id (a content hash in a built micro.html)

  // ── the scene
  frame: null,                                              // the shared coordinate frame — set by the first layer opened, cleared when the last one closes
  docBbox: null,                                            // the union bbox of every layer, frame-local [x0, y0, z0, x1, y1, z1] — null while nothing is open
  dirty: true,                                              // a redraw is owed (requestRender sets it, the render loop clears it)
  projection: null,                                         // null | 'max' | 'min' | 'mean' — the view's projection (src/projection.js); rides with the camera
};

// ask for a redraw on the next animation frame
export function requestRender() { S.dirty = true; }
// 2D overlays that ride the camera: drawn after every rendered frame (the polygon draw/edit
// tool registers here — a leaf registry, so a tool joins it without an import cycle)
export const FRAME_DRAWERS = [];

// File → FileSystemFileHandle (picker / recents / project opens)
export const _fileHandles = new WeakMap();

export const layerById = (id) => S.layers.find((l) => l.id === id) || null;
export const activeLayer = () => layerById(S.activeId);
// the ACTIVE layer's docs (always an object) — the one way to ask "what file is
// under the shared controls right now"; replaces the _blockDoc/… shadow globals
export const activeDocs = () => { const L = activeLayer(); return (L && L.docs) || {}; };
