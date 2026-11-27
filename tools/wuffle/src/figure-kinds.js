// wuffle — the ROSE and FABRIC frames of a figure: @gcu/compo kinds that draw from plain data held in the frame
// (the azimuths, the eigenvalues), through the same 2D context the PDF export uses — so they print as vectors,
// like the net does. Pure drawing: figure.js decides what goes in a frame; desk-figure.js registers these.
//   rose   content: { azimuths: [deg], binWidth, axial, scale: 'sqrt' | 'linear', color, quantity }
//   fabric content: { plot: 'vollmer' | 'woodcock', points: [{ s: [S1, S2, S3], color, label }] }

const INK = '#232322', MID = '#5A5856', SOFT = '#9a9893';
const PT = 25.4 / 72;
const font = (pt, bold = false) => `${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px "Barlow", "Helvetica Neue", Arial, sans-serif`;

/** the rose kind, over bearing's rose module (roseBins / rosePetals) */
export function roseKind(rose) {
  return {
    label: 'rose diagram',
    draw(ctx, box, frame) {
      const c = frame.content || {}, az = c.azimuths || [];
      // room for the labels: "N" / "180" above and below (a line of type), "270" / "90" beside (three digits)
      const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2 + 1, R = Math.max(2, Math.min(box[2] / 2 - 5.2, box[3] / 2 - 4.6));
      ctx.save();
      ctx.lineWidth = 0.12; ctx.strokeStyle = SOFT;
      const binned = az.length ? rose.roseBins(az, { binWidth: +c.binWidth || 10, axial: !!c.axial, ...(c.weights ? { weights: c.weights } : {}) }) : null;
      const max = binned ? binned.maxCount || 1 : 1, sqrt = c.scale !== 'linear';
      // rings at a quarter, half, three quarters and all of the largest petal's count
      for (let k = 1; k <= 4; k++) { const f = sqrt ? Math.sqrt(k / 4) : k / 4; ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 2 * Math.PI); ctx.stroke(); }
      for (let a = 0; a < 360; a += 30) { const t = (a * Math.PI) / 180; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(t), cy - R * Math.cos(t)); ctx.stroke(); }
      if (binned) {
        ctx.fillStyle = c.color || '#C2562B'; ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.15;
        for (const pt of rose.rosePetals(binned, { cx, cy, radius: R, scale: sqrt ? 'sqrt' : 'linear' })) {
          ctx.beginPath(); pt.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = INK; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.font = font(8, true); ctx.textBaseline = 'bottom'; ctx.fillText('N', cx, cy - R - 0.5);
      ctx.font = font(6.5); ctx.fillStyle = MID;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('90', cx + R + 0.8, cy); ctx.textAlign = 'right'; ctx.fillText('270', cx - R - 0.8, cy);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('180', cx, cy + R + 0.5);
      // the outer ring's count, and n
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${max}`, cx + R * 0.71 + 0.6, cy - R * 0.71 - 0.2);
      ctx.textBaseline = 'top'; ctx.fillText(`n ${az.length}${c.axial ? ' · axial' : ''}${c.weight ? ` · by ${c.weight}` : ''}`, box[0], box[1]);
      ctx.restore();
    },
  };
}

/** the fabric kind: Vollmer's P–G–R triangle or Woodcock's ln(S1/S2) : ln(S2/S3) */
export function fabricKind() {
  return {
    label: 'fabric plot',
    draw(ctx, box, frame) {
      const c = frame.content || {}, pts = c.points || [];
      ctx.save(); ctx.lineJoin = 'round';
      const dot = (x, y, col) => { ctx.fillStyle = col || INK; ctx.beginPath(); ctx.arc(x, y, 1.0, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.2; ctx.stroke(); };
      const label = (x, y, t) => { ctx.fillStyle = INK; ctx.font = font(6.5); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + 1.6, y); };
      if (c.plot === 'woodcock') {
        const pad = 6, x0 = box[0] + pad, y1 = box[1] + box[3] - pad, side = Math.min(box[2], box[3]) - pad - 2, y0 = y1 - side;
        const vals = pts.map((p) => [Math.log(p.s[1] / p.s[2]), Math.log(p.s[0] / p.s[1])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        const top = Math.max(2, Math.ceil(Math.max(0, ...vals.flat()) + 0.5));
        const X = (v) => x0 + (v / top) * side, Y = (v) => y1 - (v / top) * side;
        ctx.strokeStyle = SOFT; ctx.lineWidth = 0.12;
        for (let k = 1; k <= top; k++) { ctx.beginPath(); ctx.moveTo(X(k), y1); ctx.lineTo(X(k), y0); ctx.moveTo(x0, Y(k)); ctx.lineTo(x0 + side, Y(k)); ctx.stroke(); }
        ctx.strokeStyle = MID; ctx.lineWidth = 0.25; ctx.setLineDash && ctx.setLineDash([0.8, 0.8]);
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(top), Y(top)); ctx.stroke(); ctx.setLineDash && ctx.setLineDash([]);
        ctx.strokeStyle = INK; ctx.lineWidth = 0.3; ctx.strokeRect(x0, y0, side, side);
        ctx.fillStyle = MID; ctx.font = font(6.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('ln(S2/S3)', x0 + side / 2, y1 + 1.2);
        ctx.save(); ctx.translate(x0 - 1.4, y0 + side / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'bottom'; ctx.fillText('ln(S1/S2)', 0, 0); ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('clusters', x0 + 1.5, y0 + 1.2);
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('girdles', x0 + side - 1.5, y1 - 1.2);
        ctx.textAlign = 'left'; ctx.fillText('K = 1', X(top * 0.62) + 1, Y(top * 0.62) - 0.5);
        pts.forEach((p, i) => { const [x, y] = vals[i] || []; if (x == null) return; dot(X(x), Y(y), p.color); label(X(x), Y(y), p.label || ''); });
      } else {
        const pad = 5, side = Math.min(box[2] - 2 * pad, (box[3] - 2 * pad) / (Math.sqrt(3) / 2)), hgt = side * Math.sqrt(3) / 2;
        const cx = box[0] + box[2] / 2, yT = box[1] + (box[3] - hgt) / 2, P = [cx, yT], G = [cx - side / 2, yT + hgt], R = [cx + side / 2, yT + hgt];
        ctx.strokeStyle = SOFT; ctx.lineWidth = 0.12;
        for (const f of [0.25, 0.5, 0.75]) {                // lines of equal P, G and R
          const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          for (const [a, b, o] of [[P, G, R], [G, R, P], [R, P, G]]) { const u = lerp(o, a, f), v = lerp(o, b, f); ctx.beginPath(); ctx.moveTo(u[0], u[1]); ctx.lineTo(v[0], v[1]); ctx.stroke(); }
        }
        ctx.strokeStyle = INK; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(G[0], G[1]); ctx.lineTo(R[0], R[1]); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = INK; ctx.font = font(7.5, true); ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom'; ctx.fillText('P', P[0], P[1] - 0.6);
        ctx.textBaseline = 'top'; ctx.textAlign = 'right'; ctx.fillText('G', G[0] - 0.4, G[1] + 0.4); ctx.textAlign = 'left'; ctx.fillText('R', R[0] + 0.4, R[1] + 0.4);
        ctx.font = font(6); ctx.fillStyle = MID; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('point · girdle · random (Vollmer 1990)', cx, R[1] + 3.4);
        for (const p of pts) {
          const [s1, s2, s3] = p.s, wP = s1 - s2, wG = 2 * (s2 - s3), wR = 3 * s3;
          const x = wP * P[0] + wG * G[0] + wR * R[0], y = wP * P[1] + wG * G[1] + wR * R[1];
          if (Number.isFinite(x) && Number.isFinite(y)) { dot(x, y, p.color); label(x, y, p.label || ''); }
        }
      }
      ctx.restore();
    },
  };
}
