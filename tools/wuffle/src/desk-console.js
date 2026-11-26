// wuffle desk — the console: a real shell. @gcu/term draws it, @gcu/geas runs it (a POSIX shell with pipes,
// $(…), for/while, functions, ls/cat/grep/sed/awk/tar…), and wuffle's own commands (commands.js — the pure
// language: sample, select, stats, contour, mean, beta, undo…) are geas BUILTINS beside them. So
// `stats tocher | grep mean`, `for c in kamb fisher; do contour $c; done` and a routine that is just a
// shell script (`. /home/routine.sh`) all work, and an agent later gets the same shell.
//
// The filesystem is a @gcu/vfs: /project is the model itself as a live tree (project-fs.js — `ls`, `cat
// data/tocher.csv`, `ln -s` a layer, `rm -r` a diagram, all through the model's own rules), /home is yours
// and /tmp is scratch. The shell starts in /project.
//
// run(line) runs a line as if typed and resolves { ok, text } (what it printed, colour codes stripped).

import { Terminal, DomRenderer, Input } from '../../../ext/term/index.js';
import { createShell, createTermAdapter, makeLineEditor } from '../../../ext/geas/index.js';
import { VFS } from '../../../ext/vfs/index.js';
import { exportPDF } from '../../../ext/compo/index.js';
import { createCommands } from './commands.js';
import { projectFs } from './project-fs.js';
import { diagramSvg } from './diagram-svg.js';
import { verifyLog, describe } from './field-log.js';

const h = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const quote = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);           // commands.js keeps "quoted names" whole
const CRLF = (t) => String(t).replace(/\r?\n/g, '\r\n');
const commonPrefix = (xs) => xs.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });

export class ConsoleView {
  constructor(ctx) {
    this.p = ctx.project;
    this.cmd = createCommands(ctx);
    this.history = [];             // every line typed or run, wuffle's or the shell's
    this.transcript = '';          // everything printed, colour codes stripped (for tests and an agent)

    this.el = h('div', 'wcon');
    this.host = h('div', 'termhost');
    this.screen = h('div', 'screen');
    this.hidden = h('textarea');
    this.hidden.setAttribute('aria-label', 'console'); this.hidden.spellcheck = false;
    this.hidden.setAttribute('autocapitalize', 'off'); this.hidden.setAttribute('autocorrect', 'off');
    this.host.append(this.screen, this.hidden); this.el.append(this.host);

    this.term = new Terminal(80, 12);
    this.renderer = new DomRenderer(this.term, this.screen, { cssVarTheme: true });
    this.input = new Input(this.term, this.screen, this.hidden, this.renderer);
    this.adapter = createTermAdapter({ terminal: this.term });
    this.edit = makeLineEditor(this.adapter);
    this.el.addEventListener('mousedown', () => setTimeout(() => this.focus(), 0));
    new ResizeObserver(() => this.fit()).observe(this.el);
    this._tick();

    this.vfs = new VFS();
    this.shell = createShell({
      vfs: this.vfs,
      env: { HOME: '/home', PWD: '/home', USER: 'wuffle', TERM: 'geas' },
      cwd: '/project',
      stdout: (t) => this._write(t),
      stderr: (t) => this._write(t, '\x1b[31m'),
      builtins: this._builtins(),
      readLine: (o) => this.edit(o),   // `read` asks on the terminal
    });
    this._queue = Promise.resolve();
    // ready = the shell and its filesystems are up (run() needs only that). The banner and the prompt wait for
    // the console's FIRST real size: written at the constructed 80 × 12, the banner wrapped at 80 in a wider
    // panel and the resize to the panel shifted it, so the console seemed to start on a blank line
    this._sized = new Promise((r) => { this._onSized = r; });
    this.ready = this._boot();
    this.ready.then(() => this._start());
  }

  // ── the terminal ──
  _tick() {
    let blink = performance.now();
    const loop = (now) => {
      if (now - blink > 530) { this.renderer.cursorOn = !this.renderer.cursorOn; blink = now; this.term.dirty = true; }
      if (this.term.dirty && this.el.isConnected) { try { this.renderer.render(); } catch { /* a transient paint error */ } this.term.dirty = false; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  /** size the grid to the panel (called on every resize; the tab may be hidden at first) */
  fit() {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    // DomRenderer measures its character cell once, at construction — and the console is built before it
    // is in the page, so that measured 0 × 0 (and pinned the screen to 0 × 0). Measure again once it shows.
    if (!this.renderer.cellW || !this.renderer.cellH) { this.renderer._measure(); if (!this.renderer.cellW) return; }
    const cols = Math.max(20, Math.floor((W - 16) / this.renderer.cellW)), rows = Math.max(4, Math.floor((H - 12) / this.renderer.cellH));
    if (cols !== this.term.cols || rows !== this.term.rows) { this.term.resize(cols, rows); this.renderer.resize(); this.adapter.notifyResize(cols, rows); }
    if (this._onSized) { this._onSized(); this._onSized = null; }   // the first real size: the banner can be written
  }
  focus() { this.hidden.focus(); }
  _write(t, colour) {
    const s = String(t);
    this.transcript += s.replace(ANSI, '');
    if (this._capture) this._capture.push(s);
    this.term.write(colour ? colour + CRLF(s) + '\x1b[0m' : CRLF(s));
  }

  // ── wuffle's commands, as shell builtins ──
  _builtins() {
    const out = {};
    for (const name of this.cmd.names) {
      out[name] = async (argv, sctx) => {
        const r = this.cmd.run(argv.map(quote).join(' '));
        if (r.text) await (r.ok ? sctx.stdout : sctx.stderr)(r.text + '\n');
        return r.ok ? 0 : 1;
      };
    }
    out.history = async (argv, sctx) => { await sctx.stdout(this.history.map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n') + (this.history.length ? '\n' : '')); return 0; };
    // verify [name…] — check each field original's signature against its bytes (WebCrypto: async, hence here)
    out.verify = async (argv, sctx) => {
      const want = argv.slice(1).join(' ').trim();
      const os = this.p.originals.filter((o) => !want || o.name === want || o.name.startsWith(want));
      if (!os.length) { await sctx.stderr(want ? `no field original “${want}”\n` : 'no field originals in this project (open a field log with its .sig)\n'); return 1; }
      let bad = 0;
      for (const o of os) {
        const v = await verifyLog(o.bytes, o.sig);
        if (v.state === 'mismatch' || v.state === 'unreadable') bad++;
        await sctx.stdout(`${o.name}  (field/${o.name}/${o.file}): ${describe(v)}\n`);
      }
      return bad ? 1 : 0;
    };
    const help = out.help;
    out.help = async (argv, sctx) => {
      const s = await help(argv, sctx);
      if (argv.length < 2) await sctx.stdout(`\nand a shell (geas): ${[...this.shell.builtins.keys()].filter((n) => !this.cmd.names.includes(n) && n !== 'history').sort().join(' ')}\npipes, $(…), for / while / if, functions, > files in /home and /tmp. a routine is a script: . /home/routine.sh\n`);
      return s;
    };
    return out;
  }

  // ── /home travels with the project (project-file.js stores it under home/) ──
  get home() {
    return {
      list: async () => {
        await this.ready;
        const out = [];
        const walk = async (d) => {
          for (const n of await this.vfs.readdir(d)) {
            const q = `${d}/${n}`, st = await this.vfs.lstat(q);
            if (st.type === 'directory') await walk(q);
            else if (st.type === 'file') out.push({ path: q, bytes: await this.vfs.readFile(q, 'bytes') });
          }
        };
        await walk('/home');
        return out;
      },
      restore: async (files) => {
        await this.ready;
        await this.vfs.rm('/home', { recursive: true }); await this.vfs.mkdir('/home');
        for (const f of files) {
          const dir = f.path.slice(0, f.path.lastIndexOf('/'));
          if (dir && dir !== '/home') await this.vfs.mkdir(dir, { recursive: true });
          await this.vfs.writeFile(f.path, f.bytes);
        }
      },
      onChange: (fn) => { for (const ev of ['write', 'delete', 'mkdir', 'rename']) this.vfs.on(ev, (e) => { if (/^\/home(\/|$)/.test(String(e?.path || e?.from || ''))) fn(); }); },
    };
  }

  // ── the read → run loop ──
  async _boot() {
    await this.vfs.mount('/', { type: 'memory' });
    for (const d of ['/home', '/tmp']) await this.vfs.mkdir(d);
    await this.vfs.mount('/project', projectFs(this.p, {
      renderSvg: (id) => diagramSvg(this.p, id),
      figurePdf: async (id) => { const f = this.p.figure(id); return exportPDF(f.doc, { title: f.name, creator: 'wuffle' }); },
    }));
  }
  async _start() {
    await this._sized;
    this._write('\x1b[33mwuffle\x1b[0m \x1b[2m— the console is a shell, and /project is the project: try ls, help, cat data/*.csv. Tab completes, ↑ recalls\x1b[0m\n');
    this._loop();
  }
  _prompt() { return `\x1b[33mwuffle\x1b[0m \x1b[36m${this.shell.cwd}\x1b[0m $ `; }
  async _loop() {
    for (;;) {
      let pos = this.history.length;
      const onHistory = (dir) => { pos = Math.max(0, Math.min(this.history.length, pos + dir)); return pos < this.history.length ? this.history[pos] : ''; };
      let res;
      try { res = await this.edit({ prompt: this._prompt(), onHistory, onComplete: (b) => this.complete(b) }); } catch { this.term.write('\r\n'); continue; }
      if (!res || res.eof || !(res.line || '').trim()) continue;
      await this._exec(res.line.trim());
    }
  }
  _exec(line) {
    const job = this._queue.then(async () => {
      if (this.history.at(-1) !== line) this.history.push(line);
      this._capture = [];
      let status = 1;
      try { await this.shell.exec(line + '\n'); status = this.shell.lastStatus; }
      catch (e) { this._write(`${e.message || e}\n`, '\x1b[31m'); }
      const text = this._capture.join('').replace(ANSI, '').replace(/\n+$/, '');
      this._capture = null;
      return { ok: status === 0, text };
    });
    this._queue = job.catch(() => {});
    return job;
  }
  /** run a line as if it were typed: it shows on the console, then the prompt comes back → { ok, text } */
  async run(line) {
    await this.ready;
    this.term.write('\r\x1b[2K' + this._prompt() + line + '\r\n');
    const r = await this._exec(line);
    this.term.write(this._prompt());
    return r;
  }
  async runAll(text) {
    const out = [];
    for (const l of text.split(/\r?\n/)) if (l.trim() && !/^\s*#/.test(l)) out.push(await this.run(l));
    return out;
  }

  // ── Tab: command names first, then paths, then layer and dataset names ──
  complete(buffer) {
    const words = buffer.split(/\s+/), last = words.at(-1), head = buffer.slice(0, buffer.length - last.length);
    let pool;
    if (words.length === 1) pool = [...this.shell.builtins.keys(), ...this.shell.functions.keys()];
    else if ((last.includes('/') && !/^\d/.test(last)) || /^(cat|ls|cd|rm|ln|mv|cp|head|tail|grep|wc|less|sed|awk|mkdir|rmdir|stat|readlink|\.|source)$/.test(words[0])) return this._completePath(head, last);
    else pool = [...new Set([...this.p.layers.map((l) => this.p.dataset(l.datasetId)?.name), ...this.p.datasets.map((d) => d.name), ...this.p.diagrams.map((g) => g.name)].filter(Boolean))].map(quote);
    const m = pool.filter((n) => n.startsWith(last)).sort();
    if (m.length === 1) return { buffer: head + m[0] + ' ' };
    if (m.length > 1) { const c = commonPrefix(m); return c.length > last.length ? { buffer: head + c } : { list: m }; }
    return null;
  }
  /** a path, against the filesystem (async — geas's editor waits for it). Names with spaces come back quoted. */
  async _completePath(head, last) {
    const bare = last.replace(/^"/, ''), cut = bare.lastIndexOf('/'), dir = cut < 0 ? '' : bare.slice(0, cut + 1), stem = bare.slice(cut + 1);
    const abs = dir.startsWith('/') ? dir : `${this.shell.cwd.replace(/\/$/, '')}/${dir}`;
    let names; try { names = await this.vfs.readdir(abs || '/'); } catch { return null; }
    const m = names.filter((n) => n.startsWith(stem)).sort();
    if (!m.length) return null;
    const isDir = async (n) => { try { return (await this.vfs.stat(`${abs.replace(/\/$/, '')}/${n}`)).type === 'directory'; } catch { return false; } };
    const q = (s, closed) => (/[\s"]/.test(s) || last.startsWith('"') ? `"${s}${closed ? '"' : ''}` : s);
    if (m.length === 1) { const d = await isDir(m[0]); return { buffer: head + q(dir + m[0] + (d ? '/' : ''), !d) + (d ? '' : ' ') }; }
    const c = m.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
    return c.length > stem.length ? { buffer: head + q(dir + c, false) } : { list: m };
  }
}
