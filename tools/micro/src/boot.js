// micro — the app's entry (index.html imports this, nothing else). The parts below run in THIS
// order, each once, at load: ES modules evaluate in the order they are first imported, and every
// part imports only from the parts above it (and from the feature modules), so this list IS the
// startup sequence. A part's load-time wiring — listeners, hooks, the first layout — happens when
// its turn comes.
//
// The feature modules (open, props, gt, swath, composer, …) are not listed: they load on the way,
// as the parts import them, and do nothing at load beyond defining things and registering their
// palette commands (src/commands.js).
import './startup.js';        // theme + language first, the build stamp, the empty state, window-level wiring
import './viewport.js';       // the renderer, the camera, the render loop, view modes, the hooks back into the app
import './toolbar.js';        // the instrument bar, the dialogs' buttons
import './mobile.js';         // review mode — the phone layout (the first layout pass runs here)
import './filter-bar.js';     // colour-by, clip, the filter box + expression strip (after the layout: the strip measures it)
import './compass.js';        // the north arrow
import './samples.js';        // the bench scan, the sample model, the demo project
import './menubar.js';        // File / View / Data / Tools / Help
import './canvas-input.js';   // measure, pick, double tap, the loupe — on the 3D view
import './command-list.js';   // the palette's own commands, and its order
import './palette.js';        // ⌘K
import './keyboard.js';       // the shortcuts
import './dialogs.js';        // the dialog stack, Escape, Android Back
import './panels.js';         // the side panels' widths and buttons
import './projectgrid.js';    // projection to grid (its tool + window + the View menu row) — after the analysis stack it builds on
import './extrude.js';        // polygons → closed solids (its tool + window + the Tools menu row)
import './sectionlines.js';   // section cuts → strings (its tool + window + menu rows)
import './blockoutline.js';   // bench outlines → polygons (its tool + window + menu rows)
import './api.js';            // window._micro + window.micro — last: announcing says micro is up
