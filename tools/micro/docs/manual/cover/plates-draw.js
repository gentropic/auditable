// The drawing half of plates-data.mjs (runs in a page): the geological map sheet and the painted plates.
// Classic script; exposes window.drawSheet and window.drawPlate. Lengths in mm × PX unless noted.
(() => {
  const PAPER = [243, 238, 226];
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const RED = [214, 58, 32];
  const ORN_MM = { 2: 3.0, 3: 2.6, 5: 3.2, 6: 3.0, 7: 3.6, 8: 3.6, 9: 2.2 };   // ornament spacing on paper

  // ── ornaments: the classic rock patterns, as tiles (size in px) ──
  // `mm` is the tile's size on paper, `ppm` the drawing's pixels per mm
  function tile(code, mm, color, ppm) {
    const s = Math.round(mm * ppm), c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d'); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1, 0.13 * ppm); g.lineCap = 'round';
    const L = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); g.stroke(); };
    if (code === 8) {          // granite: crosses, staggered
      for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.75]]) { L(cx - 0.09, cy, cx + 0.09, cy); L(cx, cy - 0.09, cx, cy + 0.09); }
    } else if (code === 7) {   // volcanics: v's, staggered
      for (const [cx, cy] of [[0.25, 0.3], [0.75, 0.8]]) { g.beginPath(); g.moveTo((cx - 0.08) * s, (cy - 0.07) * s); g.lineTo(cx * s, (cy + 0.07) * s); g.lineTo((cx + 0.08) * s, (cy - 0.07) * s); g.stroke(); }
    } else if (code === 5) {   // marble/carbonate: brick
      L(0, 0.02, 1, 0.02); L(0, 0.52, 1, 0.52); L(0.25, 0.02, 0.25, 0.52); L(0.75, 0.52, 0.75, 1.02);
    } else if (code === 3) {   // quartzite: dots
      for (const [cx, cy] of [[0.2, 0.25], [0.7, 0.4], [0.35, 0.8], [0.85, 0.9]]) { g.beginPath(); g.arc(cx * s, cy * s, 0.14 * ppm, 0, 7); g.fill(); }
    } else if (code === 6) {   // phyllite: short dashes along the foliation
      L(0.1, 0.3, 0.4, 0.3); L(0.6, 0.8, 0.9, 0.8);
    } else if (code === 2) {   // gneiss: wavy lines
      g.beginPath(); for (let x = 0; x <= 1.001; x += 0.05) g.lineTo(x * s, (0.5 + 0.12 * Math.sin(x * Math.PI * 2)) * s); g.stroke();
    } else if (code === 9) {   // skarn: small x's
      L(0.4, 0.4, 0.6, 0.6); L(0.6, 0.4, 0.4, 0.6);
    } else if (code === 'ore') {
      g.lineWidth = Math.max(1.5, 0.16 * ppm); L(-0.1, 1.1, 1.1, -0.1); L(-0.1, 0.1, 0.1, -0.1); L(0.9, 1.1, 1.1, 0.9);
    } else return null;
    return c;
  }
  // fill `ctx` region (x, y, w, h) with `pattern`, but only where `mask(i)` is true over a raster of size w × h
  function ornament(ctx, x, y, w, h, test, pattern) {
    const m = document.createElement('canvas'); m.width = w; m.height = h;
    const mg = m.getContext('2d'), id = mg.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (test(i)) id.data[i * 4 + 3] = 255;
    mg.putImageData(id, 0, 0);
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const og = o.getContext('2d'); og.fillStyle = og.createPattern(pattern, 'repeat'); og.fillRect(0, 0, w, h);
    og.globalCompositeOperation = 'destination-in'; og.drawImage(m, 0, 0);
    ctx.drawImage(o, x, y);
  }
  const halo = (g, text, x, y, col = '#1e1c1a', haloCol = 'rgba(243,238,226,0.85)', lw = 0) => {
    g.lineJoin = 'round'; g.strokeStyle = haloCol; g.lineWidth = lw; if (lw) g.strokeText(text, x, y); g.fillStyle = col; g.fillText(text, x, y);
  };

  window.drawSheet = (A) => {
    const { PX, MAP, MW, MH } = A, mm = (v) => v * PX;
    const W = mm(420), H = mm(297), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = rgba(PAPER); g.fillRect(0, 0, W, H);
    const units = b64(A.units), contour = b64(A.contour);
    const COL = A.UNITS.map((u) => (u.color ? hex(u.color) : PAPER));
    const TINT = COL.map((c) => mix(c, PAPER, 0.34));
    const ORN = COL.map((c) => rgba(mix(c, [20, 20, 20], 0.55), 0.55));
    const MX = mm(MAP.x), MY = mm(MAP.y);

    // the map: fills
    const mc = document.createElement('canvas'); mc.width = MW; mc.height = MH; const mg = mc.getContext('2d');
    const base = mg.createImageData(MW, MH);
    for (let k = 0; k < MW * MH; k++) { const t = TINT[units[k] & 0x7f]; base.data.set([t[0], t[1], t[2], 255], k * 4); }
    mg.putImageData(base, 0, 0);
    // ornaments, per unit; the ore envelope's hatch
    for (const code of [2, 3, 5, 6, 7, 8, 9]) { const tl = tile(code, ORN_MM[code], ORN[code], PX); ornament(mg, 0, 0, MW, MH, (i) => (units[i] & 0x7f) === code, tl); }
    ornament(mg, 0, 0, MW, MH, (i) => units[i] & 0x80, tile('ore', 1.4, rgba(RED, 0.8), PX));
    // lines: contours (brown), contacts (ink), the ore envelope's edge (red)
    const ln = mg.createImageData(MW, MH), L = ln.data;
    const put = (k, c, a) => { if (k >= 0 && k < MW * MH && L[k * 4 + 3] < a) { L[k * 4] = c[0]; L[k * 4 + 1] = c[1]; L[k * 4 + 2] = c[2]; L[k * 4 + 3] = a; } };
    const BROWN = [146, 98, 52], INK = [32, 29, 26];
    for (let j = 0; j < MH - 1; j++) for (let i = 0; i < MW - 1; i++) {
      const k = j * MW + i;
      if (contour[k] === 1) put(k, BROWN, 120);
      else if (contour[k] === 2) { put(k, BROWN, 205); put(k + 1, BROWN, 205); }
    }
    for (let j = 0; j < MH - 1; j++) for (let i = 0; i < MW - 1; i++) {
      const k = j * MW + i, u = units[k];
      for (const n of [k + 1, k + MW]) {
        if ((u & 0x7f) !== (units[n] & 0x7f)) { put(k, INK, 235); put(n, INK, 235); }
        else if ((u & 0x80) !== (units[n] & 0x80)) { put(k, RED, 240); put(n, RED, 240); }
      }
    }
    const lc = document.createElement('canvas'); lc.width = MW; lc.height = MH; lc.getContext('2d').putImageData(ln, 0, 0);
    mg.drawImage(lc, 0, 0);
    g.drawImage(mc, MX, MY);

    // ── the vectors, clipped to the frame ──
    g.save(); g.beginPath(); g.rect(MX, MY, MW, MH); g.clip();
    const P = (p) => [MX + p[0], MY + p[1]];
    const path = (pts) => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    // contour labels
    g.font = `${mm(1.9)}px BarlowItalic`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [i, j, lvl] of A.contourLabels) halo(g, String(lvl), ...P([i, j]), rgba(BROWN), rgba(PAPER, 0.9), mm(0.9));
    // the antiform's axial trace: a line, arrows pointing away from it, and the plunge at the NE end
    const tr = A.trend * Math.PI / 180, ax = [Math.sin(tr), -Math.cos(tr)], ac = [Math.cos(tr), Math.sin(tr)];
    for (const piece of A.hinge) {
      if (piece.length < 4) continue;
      g.strokeStyle = '#2a2622'; g.lineWidth = mm(0.42); path(piece); g.stroke();
      const m = P(piece[Math.floor(piece.length / 2)]);
      for (const s of [1, -1]) {
        const ex = m[0] + ac[0] * s * mm(3.4), ey = m[1] + ac[1] * s * mm(3.4);
        g.beginPath(); g.moveTo(m[0], m[1]); g.lineTo(ex, ey); g.stroke();
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - ac[0] * s * mm(1.1) + ax[0] * mm(0.7), ey - ac[1] * s * mm(1.1) + ax[1] * mm(0.7));
        g.lineTo(ex - ac[0] * s * mm(1.1) - ax[0] * mm(0.7), ey - ac[1] * s * mm(1.1) - ax[1] * mm(0.7)); g.closePath(); g.fillStyle = '#2a2622'; g.fill();
      }
    }
    {
      const ne = A.hinge.flat().reduce((b, p) => (p[0] * ax[0] + p[1] * ax[1] > b[0] * ax[0] + b[1] * ax[1] ? p : b));
      const [x, y] = P(ne), bx = x - ax[0] * mm(5), by = y - ax[1] * mm(5);
      g.strokeStyle = '#2a2622'; g.lineWidth = mm(0.42); g.beginPath(); g.moveTo(bx, by); g.lineTo(x, y); g.stroke();
      g.beginPath(); g.moveTo(x + ax[0] * mm(1.6), y + ax[1] * mm(1.6)); g.lineTo(x + ac[0] * mm(0.8), y + ac[1] * mm(0.8)); g.lineTo(x - ac[0] * mm(0.8), y - ac[1] * mm(0.8)); g.closePath(); g.fill();
      g.font = `${mm(2.4)}px BarlowMedium`; halo(g, String(A.plunge), x + ac[0] * mm(2.8), y + ac[1] * mm(2.8), '#2a2622', rgba(PAPER, 0.85), mm(0.8));
    }
    // the fault: heavy, with ball-and-bar on the downthrown (hanging-wall) side
    g.strokeStyle = '#121110'; g.lineWidth = mm(0.62); path(A.fault); g.stroke();
    {
      const fd = [A.faultDir[0], -A.faultDir[1]]; let acc = 0;
      for (let k = 1; k < A.fault.length; k++) {
        acc += Math.hypot(A.fault[k][0] - A.fault[k - 1][0], A.fault[k][1] - A.fault[k - 1][1]);
        if (acc > mm(24)) {
          acc = 0; const [x, y] = P(A.fault[k]), ex = x + fd[0] * mm(1.8), ey = y + fd[1] * mm(1.8);
          g.lineWidth = mm(0.35); g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
          g.beginPath(); g.arc(ex, ey, mm(0.55), 0, 7); g.fillStyle = '#121110'; g.fill();
        }
      }
    }
    // strike and dip
    g.font = `${mm(2.1)}px Barlow`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [i, j, dd, dip] of A.dips) {
      const [x, y] = P([i, j]), r = dd * Math.PI / 180, sx = Math.cos(r), sy = Math.sin(r), dx = Math.sin(r), dy = -Math.cos(r);
      g.strokeStyle = '#1b1917'; g.lineWidth = mm(0.3);
      g.beginPath(); g.moveTo(x - sx * mm(2.2), y - sy * mm(2.2)); g.lineTo(x + sx * mm(2.2), y + sy * mm(2.2)); g.stroke();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * mm(1.3), y + dy * mm(1.3)); g.stroke();
      halo(g, String(dip), x + dx * mm(3.0) + sx * mm(1.4), y + dy * mm(3.0) + sy * mm(1.4), '#1b1917', rgba(PAPER, 0.8), mm(0.7));
    }
    // drillholes: plan traces, collars, names
    g.setLineDash([mm(0.9), mm(0.6)]); g.strokeStyle = '#1b1917'; g.lineWidth = mm(0.22);
    for (const h of A.holes) { path(h.trace); g.stroke(); }
    g.setLineDash([]); g.font = `${mm(1.7)}px Barlow`; g.textAlign = 'left';
    for (const h of A.holes) {
      const [x, y] = P(h.collar); g.beginPath(); g.arc(x, y, mm(0.75), 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#1b1917'; g.lineWidth = mm(0.25); g.stroke();
      halo(g, h.id, x + mm(1.0), y + mm(1.5), '#1b1917', rgba(PAPER, 0.8), mm(0.6));
    }
    // section lines: the plates
    for (const s of A.secLines) {
      g.setLineDash([mm(4.5), mm(1.6)]); g.strokeStyle = '#141210'; g.lineWidth = mm(0.4); path([s.a, s.b]); g.stroke(); g.setLineDash([]);
    }
    // unit labels
    g.font = `${mm(3.3)}px BarlowMedium`; g.textAlign = 'center';
    for (const [i, j, t] of A.labels) halo(g, t, ...P([i, j]), '#1e1c1a', rgba(PAPER, 0.7), mm(0.9));
    g.restore();
    // section-line ends: lettered discs, outside the clip so they may sit on the frame
    g.font = `${mm(2.9)}px BarlowSC`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of A.secLines) for (const [p, t] of [[s.a, s.name], [s.b, s.name + '′']]) {
      const [x, y] = [MX + p[0], MY + p[1]]; g.beginPath(); g.arc(x, y, mm(2.3), 0, 7); g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = '#141210'; g.lineWidth = mm(0.35); g.stroke(); g.fillStyle = '#141210'; g.fillText(t, x, y + mm(0.15));
    }

    // ── the frame: neatline, graticule ticks, coordinates ──
    g.strokeStyle = '#141210'; g.lineWidth = mm(0.45); g.strokeRect(MX, MY, MW, MH);
    g.lineWidth = mm(0.2); g.strokeRect(MX - mm(1.6), MY - mm(1.6), MW + mm(3.2), MH + mm(3.2));
    g.font = `${mm(2.0)}px Barlow`; g.fillStyle = '#2a2622';
    const first = (v) => Math.floor(v / 200) * 200 + 200;
    for (let x = first(A.BOX.x0); x < A.BOX.x1; x += 200) {
      const px = MX + (x - A.BOX.x0) / A.MPP;
      g.lineWidth = mm(0.25); g.beginPath(); g.moveTo(px, MY - mm(1.6)); g.lineTo(px, MY); g.moveTo(px, MY + MH); g.lineTo(px, MY + MH + mm(1.6)); g.stroke();
      const lab = `${Math.floor((A.E0 + x) / 1000)} ${String((A.E0 + x) % 1000).padStart(3, '0')}`;
      g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(lab, px, MY - mm(2.4));
      g.textBaseline = 'top'; g.fillText(lab, px, MY + MH + mm(2.4));
      for (let y = first(A.BOX.y0); y < A.BOX.y1; y += 200) {
        const py = MY + (A.BOX.y1 - y) / A.MPP; g.lineWidth = mm(0.2); g.strokeStyle = 'rgba(20,18,16,0.6)';
        g.beginPath(); g.moveTo(px - mm(1.2), py); g.lineTo(px + mm(1.2), py); g.moveTo(px, py - mm(1.2)); g.lineTo(px, py + mm(1.2)); g.stroke(); g.strokeStyle = '#141210';
      }
    }
    for (let y = first(A.BOX.y0); y < A.BOX.y1; y += 200) {
      const py = MY + (A.BOX.y1 - y) / A.MPP, lab = `${Math.floor((A.N0 + y) / 1000).toLocaleString('en').replace(',', ' ')} ${String((A.N0 + y) % 1000).padStart(3, '0')}`;
      g.lineWidth = mm(0.25); g.beginPath(); g.moveTo(MX - mm(1.6), py); g.lineTo(MX, py); g.moveTo(MX + MW, py); g.lineTo(MX + MW + mm(1.6), py); g.stroke();
      for (const [x, rot] of [[MX - mm(2.4), -Math.PI / 2], [MX + MW + mm(2.4), Math.PI / 2]]) {
        g.save(); g.translate(x, py); g.rotate(rot); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(lab, 0, 0); g.restore();
      }
    }
    g.font = `italic ${mm(1.8)}px BarlowItalic`; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText('mE', MX + MW + mm(1.2), MY - mm(2.4)); g.textBaseline = 'top'; g.fillText('mN', MX + MW + mm(3.6), MY + MH + mm(2.4));

    // under the map: scale bar and north arrow
    {
      const y = MY + MH + mm(9), x0 = MX + MW / 2 - mm(50), seg = mm(20);
      g.lineWidth = mm(0.25); g.strokeStyle = '#141210';
      for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? rgba(PAPER) : '#141210'; g.fillRect(x0 + k * seg, y, seg, mm(1.6)); g.strokeRect(x0 + k * seg, y, seg, mm(1.6)); }
      g.font = `${mm(2.2)}px Barlow`; g.fillStyle = '#141210'; g.textAlign = 'center'; g.textBaseline = 'top';
      for (let k = 0; k <= 5; k++) g.fillText(String(k * 100), x0 + k * seg, y + mm(2.4));
      g.textAlign = 'left'; g.fillText('m', x0 + 5 * seg + mm(3), y + mm(2.4));
      g.font = `${mm(3)}px BarlowSC`; g.textAlign = 'center'; g.fillText('1 : 5 000', x0 + 2.5 * seg, y + mm(6.4));
      g.font = `${mm(1.9)}px Barlow`; g.fillStyle = '#4a443d';
      g.fillText('contours every 5 m, index every 25 m, above mean sea level  ·  UTM zone 23S', x0 + 2.5 * seg, y + mm(11));
      // north arrow
      const nx = MX + MW - mm(14), ny = y + mm(4);
      g.fillStyle = '#141210'; g.beginPath(); g.moveTo(nx, ny - mm(7)); g.lineTo(nx + mm(2.2), ny + mm(2)); g.lineTo(nx, ny); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(nx, ny - mm(7)); g.lineTo(nx - mm(2.2), ny + mm(2)); g.lineTo(nx, ny); g.closePath(); g.lineWidth = mm(0.25); g.stroke();
      g.font = `${mm(3)}px BarlowSC`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('N', nx, ny - mm(7.6));
    }

    // ── the column: title block, legend, symbols, credits ──
    const CX = MX + MW + mm(13), CW = mm(420) - CX - mm(12);
    let y = MY + mm(2.5);
    const text = (t, x, yy, f, col = '#141210', align = 'left', base = 'alphabetic') => { g.font = f; g.fillStyle = col; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, yy); };
    const spaced = (t, x, yy, f, sp, col = '#141210') => { g.font = f; g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; let xx = x; for (const ch of t) { g.fillText(ch, xx, yy); xx += g.measureText(ch).width + sp; } };
    spaced('GEOSCIENTIFIC CHAOS UNION', CX, y, `${mm(2.9)}px BarlowSC`, mm(0.6), '#7a4b1c');
    text('exploration geology  ·  sheet 1 of 1', CX, y + mm(4.6), `${mm(2.4)}px BarlowLight`, '#4a443d');
    y += mm(17); text(A.NAME.toUpperCase(), CX - mm(0.6), y, `${mm(11.5)}px BarlowSC`);
    y += mm(8.2); text('PROSPECT', CX, y, `${mm(6.4)}px BarlowSCLight`);
    y += mm(7.6); text('Geological map  ·  1 : 5 000', CX, y, `${mm(3.4)}px Barlow`);
    g.fillStyle = '#7a4b1c'; g.fillRect(CX, y + mm(4), mm(26), mm(0.55));
    y += mm(15); spaced('LEGEND', CX, y, `${mm(3.0)}px BarlowSC`, mm(0.8));
    const box = (code, xx, yy) => {
      const bw = mm(10), bh = mm(5.6);
      g.fillStyle = rgba(TINT[code]); g.fillRect(xx, yy, bw, bh);
      const tl = tile(code, ORN_MM[code], ORN[code], PX); if (tl) { g.fillStyle = g.createPattern(tl, 'repeat'); g.fillRect(xx, yy, bw, bh); }
      g.strokeStyle = '#141210'; g.lineWidth = mm(0.22); g.strokeRect(xx, yy, bw, bh);
    };
    const row = (code, sym, desc) => {
      box(code, CX, y - mm(4.2));
      text(sym, CX + mm(12.5), y, `${mm(2.7)}px BarlowMedium`);
      text(desc, CX + mm(24), y, `${mm(2.45)}px Barlow`, '#2a2622');
      y += mm(7.4);
    };
    const era = (t) => { y += mm(1.2); text(t, CX, y, `${mm(2.35)}px BarlowItalic`, '#6a5f53'); y += mm(5.8); };
    y += mm(4);
    era('Neoproterozoic — intrusive');
    row(8, 'NPγ', 'granite stock: pink biotite monzogranite');
    row(9, 'sk', 'garnet–pyroxene skarn, at the marble contact');
    era('Paleoproterozoic — a shelf sequence');
    row(7, 'PPv', 'mafic metavolcanics, chlorite–actinolite schist');
    row(6, 'PPp', 'grey-green sericitic phyllite');
    row(5, 'PPm', 'banded dolomitic marble');
    row(4, 'PPf', 'banded iron formation (magnetite–quartz)');
    row(3, 'PPq', 'white quartzite, cross-bedded');
    era('Archean — basement');
    row(2, 'Agn', 'banded orthogneiss');
    y += mm(1.5);
    { const bw = mm(10), bh = mm(5.6), xx = CX, yy = y - mm(4.2);
      g.fillStyle = rgba(PAPER); g.fillRect(xx, yy, bw, bh); g.fillStyle = g.createPattern(tile('ore', 1.4, rgba(RED, 0.8), PX), 'repeat'); g.fillRect(xx, yy, bw, bh);
      g.strokeStyle = rgba(RED); g.lineWidth = mm(0.3); g.strokeRect(xx, yy, bw, bh);
      text('Au', CX + mm(12.5), y, `${mm(2.7)}px BarlowMedium`, rgba(RED));
      text('gold envelope, ≥ 1 g/t, under the regolith', CX + mm(24), y, `${mm(2.45)}px Barlow`, '#2a2622'); y += mm(7.4); }

    y += mm(5); spaced('SYMBOLS', CX, y, `${mm(3.0)}px BarlowSC`, mm(0.8)); y += mm(7);
    const sym = (draw, desc) => { g.save(); draw(CX, y - mm(1.2)); g.restore(); text(desc, CX + mm(24), y, `${mm(2.45)}px Barlow`, '#2a2622'); y += mm(6.6); };
    const seg = (x, yy, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x, yy); g.lineTo(x + mm(20), yy); g.stroke(); g.setLineDash([]); };
    sym((x, yy) => seg(x, yy, '#201d1a', mm(0.22)), 'geological contact');
    sym((x, yy) => { seg(x, yy, '#121110', mm(0.62)); g.lineWidth = mm(0.35); g.beginPath(); g.moveTo(x + mm(10), yy); g.lineTo(x + mm(10), yy + mm(1.8)); g.stroke(); g.beginPath(); g.arc(x + mm(10), yy + mm(1.8), mm(0.55), 0, 7); g.fillStyle = '#121110'; g.fill(); }, 'normal fault, ball on the downthrown side (70 m)');
    sym((x, yy) => { seg(x, yy, '#2a2622', mm(0.42)); g.fillStyle = '#2a2622'; for (const s of [1, -1]) { g.beginPath(); g.moveTo(x + mm(10), yy); g.lineTo(x + mm(10), yy + s * mm(2.6)); g.stroke(); g.beginPath(); g.moveTo(x + mm(10), yy + s * mm(3.4)); g.lineTo(x + mm(9.3), yy + s * mm(2.3)); g.lineTo(x + mm(10.7), yy + s * mm(2.3)); g.fill(); } }, 'antiform axial trace, plunge in degrees');
    sym((x, yy) => { g.strokeStyle = '#1b1917'; g.lineWidth = mm(0.3); g.beginPath(); g.moveTo(x + mm(7.8), yy); g.lineTo(x + mm(12.2), yy); g.moveTo(x + mm(10), yy); g.lineTo(x + mm(10), yy + mm(1.3)); g.stroke(); text('35', x + mm(13), yy + mm(2.6), `${mm(2.1)}px Barlow`); }, 'strike and dip of bedding');
    sym((x, yy) => { seg(x, yy - mm(0.8), rgba(BROWN, 0.5), mm(0.1)); seg(x, yy + mm(0.8), rgba(BROWN, 0.85), mm(0.18)); }, 'topographic contour, index every 25 m');
    sym((x, yy) => { seg(x + mm(1), yy, '#1b1917', mm(0.22), [mm(0.9), mm(0.6)]); g.beginPath(); g.arc(x + mm(1), yy, mm(0.75), 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#1b1917'; g.lineWidth = mm(0.25); g.stroke(); }, 'drillhole collar and trace, −60° toward 310°');
    sym((x, yy) => { seg(x, yy, '#141210', mm(0.4), [mm(4.5), mm(1.6)]); }, 'section line: the plates A–A′, B–B′, C–C′');

    y = MY + MH - mm(11);
    g.fillStyle = '#7a4b1c'; g.fillRect(CX, y - mm(6), mm(26), mm(0.4));
    for (const t of ['An imaginary deposit. Every line on this sheet was computed from',
      'one implicit model (deposit.mjs): the contacts, the bedding, the',
      'traces of the fault and the fold, the contours, the drillholes.',
      'micro  ·  a GCU field manual  ·  2026']) { text(t, CX, y, `${mm(2.2)}px BarlowLight`, '#4a443d'); y += mm(3.6); }
    return c.toDataURL('image/png').split(',')[1];
  };

  // ── a painted plate: the section in gouache on clear glass; ink contacts; the ore hatched in vermilion ──
  window.drawPlate = (A) => {
    const { PLATE, SW, SH, SEC, plate } = A, mm = (v) => v * PLATE.px;
    const W = mm(PLATE.w), H = mm(PLATE.h), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const r = b64(plate.data), COL = A.UNITS.map((u) => (u.color ? hex(u.color) : [0, 0, 0]));
    const ox = mm(PLATE.ox), oy = mm(PLATE.oy);
    const sc = document.createElement('canvas'); sc.width = SW; sc.height = SH; const sg = sc.getContext('2d');
    const id = sg.createImageData(SW, SH), d = id.data;
    // a gouache wash: opacity and value wander a little, as a brush leaves them
    const wash = (i, j) => 0.5 * Math.sin(i * 0.013 + Math.sin(j * 0.021) * 2.1) + 0.5 * Math.sin(j * 0.017 + Math.sin(i * 0.009) * 1.7);
    for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
      const k = j * SW + i, u = r[k] & 0x7f; if (!u) continue;
      const w = wash(i, j), col = mix(COL[u], w > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(w) * 0.06);
      d.set([col[0], col[1], col[2], Math.round(255 * (0.86 + 0.06 * w))], k * 4);
    }
    sg.putImageData(id, 0, 0);
    ornament(sg, 0, 0, SW, SH, (i) => r[i] & 0x80, tile('ore', 1.3, rgba(RED, 0.95), PLATE.px));
    // lines: contacts (ink), the ore's edge (vermilion), the ground surface (a heavier ink)
    const ln = sg.createImageData(SW, SH), L = ln.data;
    const put = (k, c, a) => { if (k >= 0 && k < SW * SH && L[k * 4 + 3] < a) { L.set([c[0], c[1], c[2], a], k * 4); } };
    for (let j = 0; j < SH - 1; j++) for (let i = 0; i < SW - 1; i++) {
      const k = j * SW + i, u = r[k];
      for (const n of [k + 1, k + SW]) {
        const a = u & 0x7f, b = r[n] & 0x7f;
        if (a !== b) { if (!a || !b) { if (!a && b && n === k + SW) { put(k, [40, 30, 22], 245); put(n, [40, 30, 22], 245); put(n + SW, [40, 30, 22], 245); } } else { put(k, [22, 20, 18], 230); put(n, [22, 20, 18], 230); } }
        else if ((u & 0x80) !== (r[n] & 0x80)) { put(k, RED, 245); put(n, RED, 245); put(n + 1, RED, 200); }
      }
    }
    const lc = document.createElement('canvas'); lc.width = SW; lc.height = SH; lc.getContext('2d').putImageData(ln, 0, 0); sg.drawImage(lc, 0, 0);
    // drillholes: white paint
    sg.strokeStyle = 'rgba(250,248,240,0.95)'; sg.lineWidth = 3; sg.lineCap = 'round';
    for (const t of plate.traces) { sg.beginPath(); t.forEach(([x, y], i) => (i ? sg.lineTo(x, y) : sg.moveTo(x, y))); sg.stroke(); }
    g.drawImage(sc, ox, oy);
    // the lettering, in ink: ends, elevations, the caption
    const ink = 'rgba(20,18,16,0.92)';
    g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = mm(0.18);
    g.beginPath(); g.moveTo(ox, oy + SH); g.lineTo(ox + SW, oy + SH); g.stroke();
    g.font = `${mm(1.9)}px Barlow`; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let z = -200; z <= 300; z += 100) {
      const yy = oy + (SEC.ztop - z) / (SEC.ztop - SEC.zbot) * SH;
      g.beginPath(); g.moveTo(ox - mm(1.5), yy); g.lineTo(ox, yy); g.stroke(); g.fillText(String(z), ox - mm(2), yy);
    }
    g.font = `${mm(3.6)}px BarlowSC`; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillText(plate.name, ox, oy + mm(5)); g.textAlign = 'right'; g.fillText(plate.name + '′', ox + SW, oy + mm(5));
    g.font = `${mm(2.5)}px Barlow`; g.textAlign = 'left';
    g.fillText(`${plate.name}–${plate.name}′   ·   NW → SE, looking 040°   ·   1 : 10 000   ·   ${A.NAME}`, ox, oy + SH + mm(5.2));
    return c.toDataURL('image/png').split(',')[1];
  };
})();
