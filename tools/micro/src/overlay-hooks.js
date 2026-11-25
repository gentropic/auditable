// What other modules hang on the 3D-view overlay, kept in a LEAF (no imports) so a module can
// register at load time without joining overlay.js's import cycle:
//   - drawers: more things drawn over the view that ride the camera (the points of interest);
//   - the poi sink: where a point-of-interest click (measure mode 'poi') sends its TRUE world point.

export const overlayDrawers = [];
export function addOverlayDrawer(fn) { overlayDrawers.push(fn); }

let _poiSink = null;
export function setPoiSink(fn) { _poiSink = fn; }
export function poiSink() { return _poiSink; }
