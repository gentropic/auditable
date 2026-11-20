// Picking — "what is under the pointer?" in under a millisecond at a million points.
//
// Each pickable trace gets a uniform grid of its points in PIXEL space (a counting sort into
// CELL-px cells), built lazily on the first pick after a render and thrown away by the next
// render, since any change of view moves every pixel. A pick then looks only at the cells
// within `radius` of the pointer.

const _CELL = 16;

// px, py: device-independent pixel positions (NaN = off the axes or not finite)
export function _buildGrid(px, py, x0, y0, w, h, pad) {
  const cols = Math.max(1, Math.ceil((w + 2 * pad) / _CELL));
  const rows = Math.max(1, Math.ceil((h + 2 * pad) / _CELL));
  const n = px.length;
  const cellOf = new Int32Array(n);
  const counts = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const X = px[i], Y = py[i];
    if (X !== X || Y !== Y) { cellOf[i] = -1; continue; }
    const cx = Math.floor((X - x0 + pad) / _CELL), cy = Math.floor((Y - y0 + pad) / _CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { cellOf[i] = -1; continue; }
    const c = cy * cols + cx;
    cellOf[i] = c;
    counts[c + 1]++;
  }
  for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
  const start = counts.slice(0, cols * rows + 1);
  const items = new Int32Array(counts[cols * rows]);
  const fillAt = start.slice();
  for (let i = 0; i < n; i++) { const c = cellOf[i]; if (c >= 0) items[fillAt[c]++] = i; }
  return { cols, rows, x0: x0 - pad, y0: y0 - pad, start, items, px, py };
}

// nearest point of the grid within `radius` px of (qx, qy): { index, d } or null
export function _queryGrid(g, qx, qy, radius) {
  const c0 = Math.max(0, Math.floor((qx - radius - g.x0) / _CELL)), c1 = Math.min(g.cols - 1, Math.floor((qx + radius - g.x0) / _CELL));
  const r0 = Math.max(0, Math.floor((qy - radius - g.y0) / _CELL)), r1 = Math.min(g.rows - 1, Math.floor((qy + radius - g.y0) / _CELL));
  let best = -1, bd = radius * radius;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * g.cols + c;
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
        const i = g.items[k];
        const dx = g.px[i] - qx, dy = g.py[i] - qy, d = dx * dx + dy * dy;
        // ties go to the later point: it is the one drawn on top
        if (d < bd || (d === bd && i > best)) { bd = d; best = i; }
      }
    }
  }
  return best < 0 ? null : { index: best, d: Math.sqrt(bd) };
}
