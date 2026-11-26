// scenes for "A day's work" (ch. workflow): one outcrop day, from the signed field log to the report.
// The staging helpers are exported too: experiments/wuffle-probe-wf2.mjs runs the same steps, so every
// number the chapter quotes comes from exactly what these shots show.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };

// the field log the chapter prints (field.js's publish format), byte for byte
export const LOG = `type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo
plane,164,75,74,2026-11-20T13:02:10.000Z,-30.071200,-51.120300,4,true,-15.21,
plane,44,63,314,2026-11-20T13:04:21.000Z,-30.071220,-51.120270,5,true,-15.21,
plane,62,44,332,2026-11-20T13:06:32.000Z,-30.071240,-51.120240,6,true,-15.21,
line,115,23,,2026-11-20T13:08:43.000Z,-30.071260,-51.120210,4,true,-15.21,
line,124,28,,2026-11-20T13:10:54.000Z,-30.071280,-51.120180,5,true,-15.21,wuffle-005-2026-11-20T131054.jpg
plane,86,29,356,2026-11-20T13:13:05.000Z,-30.071300,-51.120150,6,true,-15.21,
plane,201,68,111,2026-11-20T13:15:16.000Z,-30.071320,-51.120120,4,true,-15.21,
plane,65,36,335,2026-11-20T13:17:27.000Z,-30.071340,-51.120090,5,true,-15.21,
plane,192,54,102,2026-11-20T13:19:38.000Z,-30.071360,-51.120060,6,true,-15.21,
plane,167,71,77,2026-11-20T13:21:49.000Z,-30.071380,-51.120030,4,true,-15.21,
plane,288,83,198,2026-11-20T13:24:00.000Z,-30.071400,-51.120000,5,true,-15.21,
plane,79,31,349,2026-11-20T13:26:11.000Z,-30.071420,-51.119970,6,true,-15.21,
plane,50,54,320,2026-11-20T13:28:22.000Z,-30.071440,-51.119940,4,true,-15.21,
line,124,28,,2026-11-20T13:30:33.000Z,-30.071460,-51.119910,5,true,-15.21,
plane,290,86,200,2026-11-20T13:32:44.000Z,-30.071480,-51.119880,6,true,-15.21,
plane,172,72,82,2026-11-20T13:34:55.000Z,-30.071500,-51.119850,4,true,-15.21,
plane,179,45,89,2026-11-20T13:37:06.000Z,-30.071520,-51.119820,5,true,-15.21,
plane,295,85,205,2026-11-20T13:39:17.000Z,-30.071540,-51.119790,6,true,-15.21,wuffle-018-2026-11-20T133917.jpg
plane,159,73,69,2026-11-20T13:41:28.000Z,-30.071560,-51.119760,4,true,-15.21,
plane,292,84,202,2026-11-20T13:43:39.000Z,-30.071580,-51.119730,5,true,-15.21,
plane,169,77,79,2026-11-20T13:45:50.000Z,-30.071600,-51.119700,6,true,-15.21,
plane,296,83,206,2026-11-20T13:48:01.000Z,-30.071620,-51.119670,4,true,-15.21,
plane,201,72,111,2026-11-20T13:50:12.000Z,-30.071640,-51.119640,5,true,-15.21,
plane,293,82,203,2026-11-20T13:52:23.000Z,-30.071660,-51.119610,6,true,-15.21,
plane,36,72,306,2026-11-20T13:54:34.000Z,-30.071680,-51.119580,4,true,-15.21,
plane,195,63,105,2026-11-20T13:56:45.000Z,-30.071700,-51.119550,5,true,-15.21,
plane,55,50,325,2026-11-20T13:58:56.000Z,-30.071720,-51.119520,6,true,-15.21,
line,123,23,,2026-11-20T14:01:07.000Z,-30.071740,-51.119490,4,true,-15.21,
plane,190,49,100,2026-11-20T14:03:18.000Z,-30.071760,-51.119460,5,true,-15.21,
line,116,28,,2026-11-20T14:05:29.000Z,-30.071780,-51.119430,6,true,-15.21,
plane,160,70,70,2026-11-20T14:07:40.000Z,-30.071800,-51.119400,4,true,-15.21,
plane,171,34,81,2026-11-20T14:09:51.000Z,-30.071820,-51.119370,5,true,-15.21,
line,116,21,,2026-11-20T14:12:02.000Z,-30.071840,-51.119340,6,true,-15.21,
plane,296,84,206,2026-11-20T14:14:13.000Z,-30.071860,-51.119310,4,true,-15.21,
plane,160,77,70,2026-11-20T14:16:24.000Z,-30.071880,-51.119280,5,true,-15.21,
plane,175,39,85,2026-11-20T14:18:35.000Z,-30.071900,-51.119250,6,true,-15.21,
plane,291,83,201,2026-11-20T14:20:46.000Z,-30.071920,-51.119220,4,true,-15.21,
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
