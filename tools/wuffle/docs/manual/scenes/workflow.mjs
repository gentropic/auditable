// scenes for "A day's work" (ch. workflow): one outcrop day, from the signed field log to the report.
// The staging helpers are exported too: experiments/wuffle-probe-wf2.mjs runs the same steps, so every
// number the chapter quotes comes from exactly what these shots show.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };

// the field log the chapter prints (field.js's publish format), byte for byte
export const LOG = `type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo
plane,164,75,74,2026-11-20T13:02:10.000Z,-30.0712,-51.1203,4,true,-17.8,
plane,44,63,314,2026-11-20T13:04:21.000Z,-30.07122,-51.12027,5,true,-17.8,
plane,62,44,332,2026-11-20T13:06:32.000Z,-30.07124,-51.12024,6,true,-17.8,
line,115,23,,2026-11-20T13:08:43.000Z,-30.07126,-51.12021,4,true,-17.8,
line,124,28,,2026-11-20T13:10:54.000Z,-30.07128,-51.12018,5,true,-17.8,wuffle-005-2026-11-20T131054.jpg
plane,86,29,356,2026-11-20T13:13:05.000Z,-30.0713,-51.12015,6,true,-17.8,
plane,201,68,111,2026-11-20T13:15:16.000Z,-30.07132,-51.12012,4,true,-17.8,
plane,65,36,335,2026-11-20T13:17:27.000Z,-30.07134,-51.12009,5,true,-17.8,
plane,192,54,102,2026-11-20T13:19:38.000Z,-30.07136,-51.12006,6,true,-17.8,
plane,167,71,77,2026-11-20T13:21:49.000Z,-30.07138,-51.12003,4,true,-17.8,
plane,288,83,198,2026-11-20T13:24:00.000Z,-30.0714,-51.12,5,true,-17.8,
plane,79,31,349,2026-11-20T13:26:11.000Z,-30.07142,-51.11997,6,true,-17.8,
plane,50,54,320,2026-11-20T13:28:22.000Z,-30.07144,-51.11994,4,true,-17.8,
line,124,28,,2026-11-20T13:30:33.000Z,-30.07146,-51.11991,5,true,-17.8,
plane,290,86,200,2026-11-20T13:32:44.000Z,-30.07148,-51.11988,6,true,-17.8,
plane,172,72,82,2026-11-20T13:34:55.000Z,-30.0715,-51.11985,4,true,-17.8,
plane,179,45,89,2026-11-20T13:37:06.000Z,-30.07152,-51.11982,5,true,-17.8,
plane,295,85,205,2026-11-20T13:39:17.000Z,-30.07154,-51.11979,6,true,-17.8,wuffle-018-2026-11-20T133917.jpg
plane,159,73,69,2026-11-20T13:41:28.000Z,-30.07156,-51.11976,4,true,-17.8,
plane,292,84,202,2026-11-20T13:43:39.000Z,-30.07158,-51.11973,5,true,-17.8,
plane,169,77,79,2026-11-20T13:45:50.000Z,-30.0716,-51.1197,6,true,-17.8,
plane,296,83,206,2026-11-20T13:48:01.000Z,-30.07162,-51.11967,4,true,-17.8,
plane,201,72,111,2026-11-20T13:50:12.000Z,-30.07164,-51.11964,5,true,-17.8,
plane,293,82,203,2026-11-20T13:52:23.000Z,-30.07166,-51.11961,6,true,-17.8,
plane,36,72,306,2026-11-20T13:54:34.000Z,-30.07168,-51.11958,4,true,-17.8,
plane,195,63,105,2026-11-20T13:56:45.000Z,-30.0717,-51.11955,5,true,-17.8,
plane,55,50,325,2026-11-20T13:58:56.000Z,-30.07172,-51.11952,6,true,-17.8,
line,123,23,,2026-11-20T14:01:07.000Z,-30.07174,-51.11949,4,true,-17.8,
plane,190,49,100,2026-11-20T14:03:18.000Z,-30.07176,-51.11946,5,true,-17.8,
line,116,28,,2026-11-20T14:05:29.000Z,-30.07178,-51.11943,6,true,-17.8,
plane,160,70,70,2026-11-20T14:07:40.000Z,-30.0718,-51.1194,4,true,-17.8,
plane,171,34,81,2026-11-20T14:09:51.000Z,-30.07182,-51.11937,5,true,-17.8,
line,116,21,,2026-11-20T14:12:02.000Z,-30.07184,-51.11934,6,true,-17.8,
plane,296,84,206,2026-11-20T14:14:13.000Z,-30.07186,-51.11931,4,true,-17.8,
plane,160,77,70,2026-11-20T14:16:24.000Z,-30.07188,-51.11928,5,true,-17.8,
plane,175,39,85,2026-11-20T14:18:35.000Z,-30.0719,-51.11925,6,true,-17.8,
plane,291,83,201,2026-11-20T14:20:46.000Z,-30.07192,-51.11922,4,true,-17.8,
`;

// 1. open the log signed (a key made here stands in for the phone's), with its .sig and two photos
export async function openLog(ev) {
  await ev(async (log) => {
    const W = window.__wuffleDesk, enc = new TextEncoder(), b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
    const bytes = enc.encode(log);
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const sig = JSON.stringify({ file: 'wuffle-log.csv', alg: 'ECDSA-P256-SHA256', sig: b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes)),
      pub: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), hash: '', security: 'strongbox', signedAt: '2026-11-20T18:40:02.311Z' }, null, 1);
    const jpg = () => new Promise((res) => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = '#7a6a55'; g.fillRect(0, 0, 64, 48); c.toBlob(res, 'image/jpeg'); });
    const names = log.split('\n').map((l) => l.split(',')[10]).filter((x) => x && x.endsWith('.jpg'));
    await W.files.open([new File([bytes], 'wuffle-log.csv'), new File([sig], 'wuffle-log.csv.sig'), ...await Promise.all(names.map(async (n) => new File([await jpg()], n)))]);
    await new Promise((r) => setTimeout(r, 300));
  }, LOG);
}

// 2. the sets: J1 and J2 by a cone each, bedding = the rest; each kept as a dataset (as the layer menu's
//    Selection → new dataset, then Rename…, would)
export async function makeSets(ev) {
  await ev(async () => {
    const W = window.__wuffleDesk, Q = W.project, run = (l) => W.console.run(l);
    const planes = () => Q.datasets.find((x) => x.name === 'field 2026-11-20 · planes');
    const keep = (name) => { const id = Q.selectionToDataset(planes().id); Q.renameDataset(id, name); return id; };
    await run('select cone 292/84 15'); keep('J1');
    await run('select cone 166/74 15'); keep('J2');
    await run('select all'); await run('select - cone 292/84 15'); await run('select - cone 166/74 15'); keep('bedding');
    await run('select none');
  });
}

// 3. a net of the sets, styled; bedding contoured with V3, a mean on each joint set and on the hinge lines
export async function setsNet(ev, { analysis = true } = {}) {
  await ev(async (analysis) => {
    const W = window.__wuffleDesk, Q = W.project, by = (n) => Q.datasets.find((x) => x.name === n).id, run = (l) => W.console.run(l);
    const g = Q.addDiagram('net', { name: 'Sets' }); Q.setActive(g); W.rails.activateTab('diag:' + g);
    const add = (n, color) => { const L = Q.addLayer(g, by(n)); Q.setLayerStyle(L, { color }); return L; };
    add('bedding', '#3a7bd5'); add('J1', '#e07a5f'); add('J2', '#2f9e57'); add('field 2026-11-20 · lines', '#8a6d3b');
    if (analysis) for (const l of ['contour kamb 3 bedding', 'show v3 bedding', 'show mean J1', 'show mean J2', 'show mean field']) await run(l);
    await new Promise((r) => setTimeout(r, 300));
  }, analysis);
}

// 4. the fold axis four ways: V3 (drawn), β → dataset, the limbs' intersection, the hinge lines' mean
export async function foldAxis(ev) {
  await ev(async () => {
    const W = window.__wuffleDesk, Q = W.project, run = (l) => W.console.run(l);
    const bed = () => Q.datasets.find((x) => x.name === 'bedding');
    const limb = (name, test) => { const d = bed(); Q.select(d.id, d.rows.map((_, i) => i).filter((i) => test(+d.rows[i].dip_dir_or_trend))); const id = Q.selectionToDataset(d.id); Q.renameDataset(id, name); return id; };
    const ne = limb('NE limb', (dd) => dd < 120), sw = limb('SW limb', (dd) => dd >= 120); Q.clearSelection();
    const g = Q.activeDiagram;
    // the limbs as layers (intersect works on layers), hidden: their poles are the bedding's
    for (const id of [ne, sw]) Q.setLayerVisible(Q.addLayer(g, id), false);
    for (const L of Q.layersOf(g)) {
      const n = Q.dataset(L.datasetId).name;
      if (n === 'J1' || n === 'J2') Q.setLayerVisible(L.id, false);
      if (n === 'bedding') { Q.setElement(L.id, 'contours', false); Q.setElement(L.id, 'v3Circle', true); }
    }
    await run('beta bedding'); await run('intersect NE SW'); await run('mean field');
    const beta = Q.layersOf(g).find((L) => Q.dataset(L.datasetId).name === 'bedding · β'); if (beta) Q.setLayerStyle(beta.id, { color: '#9a9893', size: 2.5 });
    await new Promise((r) => setTimeout(r, 300));
  });
}

export const SCENES = {
  // the log opened: two datasets drawn on Net 1, the table of the planes, the status line's verdict
  'wf-opened': {
    viewport: VP,
    async stage({ ev }) {
      await openLog(ev);
      await ev(async () => { const W = window.__wuffleDesk; W.rails.activateTab('table'); });
      return { wait: 700 };
    },
  },
  // the split: J1's cone typed in the console, its eight poles violet, the dashed cone on the net
  'wf-split': {
    viewport: VP,
    async stage({ ev }) {
      await openLog(ev);
      await ev(async () => { const W = window.__wuffleDesk; W.menus.run('console'); await new Promise((r) => setTimeout(r, 200)); await W.console.run('layers'); await W.console.run('select cone 292/84 15'); });
      return { wait: 700 };
    },
  },
  // the sets on their own net, with the tree: bedding contoured (and its V3), the means of J1, J2 and the hinge lines
  'wf-sets': {
    viewport: VP,
    async stage({ p, ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev);
      await ev(async () => { window.__wuffleDesk.rails.activateTab('stats'); });
      await p.mouse.move(5, 5);
      return { wait: 800 };
    },
  },
  // the bedding's statistics card: a girdle (K 0.01), V3 120→25
  'wf-card': {
    viewport: { width: 1180, height: 1200 },   // tall: the stats panel shows the whole card, buttons and all
    async stage({ ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev);
      // the card scrolls inside its panel and the status bar overlaps its foot: hide the bar for this capture
      // the card is clipped by its panel: capture a copy floated above the page (same classes, same look)
      await ev(async () => {
        window.__wuffleDesk.rails.activateTab('stats'); await new Promise((r) => setTimeout(r, 300));
        const card = document.querySelector('.wst-card'), c = card.cloneNode(true);
        c.id = 'wf-card-copy'; Object.assign(c.style, { position: 'fixed', left: '24px', top: '24px', zIndex: 9999, width: card.offsetWidth + 'px' });
        const back = document.createElement('div');   // the panel's ground behind it, so nothing shows through the card
        Object.assign(back.style, { position: 'fixed', inset: '0', zIndex: 9998, background: getComputedStyle(card.parentElement).backgroundColor || '#f1efeb' });
        card.parentElement.append(back, c);
      });
      return { el: '#wf-card-copy', wait: 500 };
    },
  },
  // a rose of the strikes of the three sets (made from the Sets net before the fold-axis work)
  'wf-rose': {
    viewport: VP,
    async stage({ ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev, { analysis: false });
      await ev(async () => { await window.__wuffleDesk.console.run('new rose'); });   // a strike rose skips the lines by itself
      return { el: '.wdg-plain', wait: 700 };
    },
  },
  // the fabric plot: bedding a girdle, the joints and the hinge lines clusters
  'wf-fabric': {
    viewport: VP,
    async stage({ ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev, { analysis: false });
      // Woodcock's plot: on Vollmer's triangle J1, J2 and the hinge lines all sit at the P corner and their
      // labels overprint; on Woodcock's they spread by strength (C) and shape (K)
      await ev(async () => { const W = window.__wuffleDesk; await W.console.run('new fabric'); W.project.setDiagramProps(W.project.activeDiagram, { plot: 'woodcock' }); await new Promise((r) => setTimeout(r, 300)); });
      return { el: '.wdg-paper', wait: 700 };
    },
  },
  // the fold axis four ways, on the net alone
  'wf-axis': {
    viewport: VP,
    async stage({ p, ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev); await foldAxis(ev);
      await p.mouse.move(5, 5);
      return { el: '.wn-stage >> visible=true', wait: 800 };
    },
  },
  // the figure from the Sets net (the fold-axis estimates hidden, so the page shows the sets)
  'wf-figure': {
    viewport: { width: 1280, height: 820 },
    async stage({ p, ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev);
      await ev(async () => { const W = window.__wuffleDesk; W.menus.run('figure'); await new Promise((r) => setTimeout(r, 900)); });
      await p.mouse.move(5, 5);
      return { wait: 900 };
    },
  },
  // the routine: written to /home, run, its report kept in /home
  'wf-routine': {
    viewport: VP,
    async stage({ ev }) {
      await openLog(ev); await makeSets(ev); await setsNet(ev);
      await ev(async () => {
        const W = window.__wuffleDesk; W.menus.run('console'); await new Promise((r) => setTimeout(r, 200));
        for (const l of [
          "printf 'use Sets\\nfor s in bedding J1 J2 field; do stats $s; done\\n' > /home/sets.sh",
          '. /home/sets.sh > /home/report.txt',
          'head -6 /home/report.txt',
        ]) await W.console.run(l);
      });
      return { el: '.wcon', wait: 700 };
    },
  },
};
