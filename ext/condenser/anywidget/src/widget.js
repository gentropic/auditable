// @gcu/condenser — the anywidget (Jupyter) adapter. The viewer itself is the plain-JS view
// (../../view/src/view.js), shared with pages; it talks to a small state store whose
// contract is anywidget's model API, and whose keys are this widget's trait names. So the
// adapter is the identity: the model IS the store.
//
// anywidget wants a DEFAULT export; @gcu/build emits named exports only (its
// rename-on-collision pass needs names). So this is named, and build.js appends the
// one-line `export default { render }` footer to the bundle.
import { mountView } from '../../view/src/view.js';

export function render({ model, el }) {
  return mountView(el, model);
}
