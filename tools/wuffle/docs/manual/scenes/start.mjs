// scenes for Part I, the console part and the projects part (ch. 1–6)
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };
const PHONE = { width: 412, height: 860 };


// a desk with the Tocher sample open (the menu's own action) and the console tab in front
async function tocher(ev, { console = false } = {}) {
  await ev(async (c) => {
    const W = window.__wuffleDesk;
    W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
    if (c) { W.menus.run('console'); await new Promise((r) => setTimeout(r, 300)); }
  }, console);
}
// lines typed into the console as if by hand (they show on it, the prompt comes back)
const typed = (ev, lines) => ev(async (ls) => { for (const l of ls) await window.__wuffleDesk.console.run(l); }, lines);

// a synthetic orientation reading: what the phone's sensor event would deliver (alpha = compass heading)
const orient = (p, alpha, beta, gamma) => p.evaluate(([a, b, g]) => {
  const e = new Event('deviceorientationabsolute'); Object.assign(e, { alpha: a, beta: b, gamma: g, absolute: true });
  window.dispatchEvent(e);
}, [alpha, beta, gamma]);

export const SCENES = {
  // ch. 2 — the desk with the Tocher sample, contoured, one pole selected
  'desk-tour': {
    viewport: VP,   // smaller than a monitor, so the UI's text reads on the page
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const L = P.layers[0]; P.setElement(L.id, 'contours', true);
        P.select(L.datasetId, [12]);
        W.menus.run('console'); await new Promise((r) => setTimeout(r, 200));
        W.rails.activateTab('diag:' + P.diagrams[0].id);
      });
      await settle(600);
      await p.mouse.move(5, 5);
      return { wait: 800 };
    },
  },

  // ch. 2 — the status line: counts, the pointer's reading, the theme
  'status-line': {
    viewport: VP,
    async stage({ p, ev }) {
      await tocher(ev);
      await ev(() => { const P = window.__wuffleDesk.project; P.select(P.datasets[0].id, [3, 12, 40]); });
      await settle(300);
      const box = await p.locator('.wn-stage svg').boundingBox();
      await p.mouse.move(box.x + box.width * 0.33, box.y + box.height * 0.62);
      return { el: '.wstatus', wait: 400 };
    },
  },

  // ch. 2 — the File menu open
  'file-menu': {
    viewport: VP,
    async stage({ p, ev }) {
      await tocher(ev);
      await p.locator('.gcu-menubar-trigger', { hasText: 'File' }).click();
      await settle(300);
      return { el: '.gcu-menu', wait: 300 };
    },
  },

  // ch. 2 — the same desk in the basalt (dark) theme
  'desk-dark': {
    viewport: VP,
    async stage({ p, ev }) {
      await tocher(ev);
      await ev(() => { const W = window.__wuffleDesk, P = W.project; W.setTheme('dark'); P.setElement(P.layers[0].id, 'contours', true); });
      await settle(500); await p.mouse.move(5, 5);
      return { wait: 600 };
    },
  },

  // ch. 4 — the console after a few commands
  'console': {
    viewport: VP,
    async stage({ ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk;
        W.menus.run('console'); await new Promise((r) => setTimeout(r, 300));
        for (const line of ['sample tocher', 'contour kamb 3', 'select cone 040/50 20', 'stats']) await W.console.run(line);
      });
      return { wait: 900 };
    },
  },

  // ch. 4 — a routine written into /home and run
  'console-routine': {
    viewport: VP,
    async stage({ ev }) {
      await tocher(ev, { console: true });
      await typed(ev, ["printf 'contour kamb 3\\nshow mean\\nstats\\n' > /home/fabric.sh", 'clear', 'cat /home/fabric.sh', '. /home/fabric.sh']);
      return { el: '.wcon', wait: 800 };
    },
  },

  // ch. 5 — /project read as files: a layer is a symlink, the diagram's settings are JSON
  'project-ls': {
    viewport: VP,
    async stage({ ev }) {
      await tocher(ev, { console: true });
      await typed(ev, ['ls', 'ls -l "diagrams/Net 1/layers"']);
      return { el: '.wcon', wait: 800 };
    },
  },

  // ch. 6 — the Edit menu naming the step it would undo
  'edit-menu': {
    viewport: VP,
    async stage({ p, ev }) {
      await tocher(ev);
      await ev(() => { const P = window.__wuffleDesk.project; P.setElement(P.layers[0].id, 'contours', true); });
      await p.locator('.gcu-menubar-trigger', { hasText: 'Edit' }).click();
      await settle(300);
      return { el: '.gcu-menu', wait: 300 };
    },
  },

  // ch. 6 — a signed field log opened: the original's verdict in the status line, its data in the tree
  'fieldlog-open': {
    viewport: VP,
    async stage({ ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, enc = new TextEncoder();
        const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
        const log = 'type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo\n'
          + 'plane,120,45,30,2026-11-20T14:02:11.000Z,-30.10012,-51.20034,4,true,-17.74,\n'
          + 'plane,118,47,28,2026-11-20T14:05:40.000Z,-30.1002,-51.20041,4,true,-17.74,wuffle-002-2026-11-20T140540.jpg\n'
          + 'plane,124,43,34,2026-11-20T14:07:13.000Z,-30.10024,-51.20052,3,true,-17.74,\n'
          + 'line,200,20,,2026-11-20T14:09:02.000Z,-30.10031,-51.2006,5,true,-17.74,\n';
        const bytes = enc.encode(log);
        const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        const sig = JSON.stringify({ file: 'wuffle-log.csv', alg: 'ECDSA-P256-SHA256', sig: b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes)),
          pub: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), security: 'strongbox', signedAt: '2026-11-20T15:02:40Z' }, null, 1);
        await W.files.open([new File([bytes], 'wuffle-log.csv'), new File([sig], 'wuffle-log.csv.sig'), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'wuffle-002-2026-11-20T140540.jpg')]);
        W.rails.activateTab('diag:' + W.project.diagrams[0].id);
      });
      return { wait: 700 };
    },
  },

  // ch. 3 — the compass on a phone-sized window, three typed measurements
  'field-net': {
    query: '?field',
    viewport: PHONE,
    async stage({ p }) {
      for (const m of ['120/45', '118/47', '200>20']) { await p.fill('#manual', m); await p.press('#manual', 'Enter'); }
      return { wait: 600 };
    },
  },

  // ch. 3 — plane mode, a live reading: the dashed ghost great circle and the numbers in the corner
  'field-live-plane': {
    query: '?field',
    viewport: PHONE,
    async stage({ p }) {
      for (const m of ['120/45', '118/47']) { await p.fill('#manual', m); await p.press('#manual', 'Enter'); }
      await orient(p, 330, 38, -22);
      return { el: '#net', wait: 500 };
    },
  },

  // ch. 3 — line mode: the ghost is a point, the corner reads trend and plunge
  'field-live-line': {
    query: '?field',
    viewport: PHONE,
    async stage({ p }) {
      await p.click('#mLine');
      for (const m of ['200>20', '210>25']) { await p.fill('#manual', m); await p.press('#manual', 'Enter'); }
      await orient(p, 20, 30, 5);
      return { el: '#net', wait: 500 };
    },
  },

  // ch. 3 — the log with a photo attached to the last measurement (a canvas stands in for the camera)
  'field-photo': {
    query: '?field',
    viewport: PHONE,
    async stage({ p }) {
      await p.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d'); g.fillStyle = '#7a6a55'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#a89878'; for (let i = 0; i < 12; i++) g.fillRect(0, i * 40 + 8, 640, 14);
        const stream = c.captureStream(10);
        const tick = () => { g.fillRect(0, 0, 1, 1); requestAnimationFrame(tick); }; tick();
        navigator.mediaDevices.getUserMedia = async () => stream;
      });
      for (const m of ['120/45', '118/47', '200>20']) { await p.fill('#manual', m); await p.press('#manual', 'Enter'); }
      await p.click('#photo');
      await settle(900);
      await p.click('#snap');
      await settle(600);
      return { el: 'body', wait: 400 };
    },
  },
};
