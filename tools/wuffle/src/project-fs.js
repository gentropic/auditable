// wuffle — /project: the model as a live filesystem (a @gcu/vfs backend). Nothing is stored here: every
// read is made from the Project as it is now, and every write goes through the Project's own methods — so
// the model's rules hold for the shell exactly as for the UI (data still drawn can't be deleted, a layer is
// a VIEW of its data, every change is one undo step).
//
//   project.json                          name and counts                                (read)
//   data/<name>.csv                       the rows                 write: replace the rows · a new name: new data
//   data/<name>.json                      kind, roles, notation, lineage                 (read)
//   diagrams/<name>/                      mkdir: a new net · rm -r: remove it · mv: rename
//   diagrams/<name>/diagram.json          kind, name, props        write: rename, change settings
//   diagrams/<name>/<kind>.svg            the diagram as drawn                           (read)
//   diagrams/<name>/layers/<l>.csv  →  ../../../data/<name>.csv   a SYMLINK: the layer IS a view of the data
//                                         ln -s: draw data here · rm: remove the view · mv to another diagram: move
//   diagrams/<name>/layers/<l>.json       visible, style, elements write: show / hide / style
//   figures/<name>.compo.json             a figure page            write: change it · a new name: new figure · rm
//   figures/<name>.pdf                    the page as a PDF                              (read)
//   selection/<data>.rows                 selected row numbers, 1-based, one per line    write: select · rm: clear
//   selection/<data>.csv                  the selected rows                              (read)
//
// A name with a "/" in it shows with "∕" (U+2215) instead.

import { VFSError } from '../../../ext/vfs/index.js';
import { readTable, parseDelimited } from './io.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const F = (name) => String(name).replace(/\//g, '∕');
const err = (code, p, msg) => new VFSError(code, p, msg ? `${msg}: ${p}` : undefined);
const json = (v) => JSON.stringify(v, null, 2) + '\n';

/** a name as a path segment: "/" shows as "∕" (U+2215) */
export const fileName = F;

/** a diagram's layers with their file base names — the layer's own name, else its data's; repeats numbered.
 *  ONE definition: /project and the .zip.wuffle must name the same layer the same way. */
export function layerBases(p, g) {
  const used = new Map();
  return p.layersOf(g.id).map((l) => {
    const base = F(l.name || p.dataset(l.datasetId)?.name || l.id);
    const k = (used.get(base) || 0) + 1; used.set(base, k);
    return { l, base: k === 1 ? base : `${base} (${k})` };
  });
}

/** RFC 4180 CSV of rows over columns */
export function toCsv(columns, rows) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

/**
 * @param {import('./model.js').Project} p
 * @param {{ renderSvg?: (diagramId) => string|null, figurePdf?: (figureId) => Promise<Uint8Array>, mount?: string }} hooks
 *   mount — where this is mounted ('/project'): lets an absolute symlink target name the data.
 */
export function projectFs(p, { renderSvg = null, figurePdf = null, mount = '/project' } = {}) {
  let mtime = new Date();
  p.on(() => { mtime = new Date(); });

  // ── naming: path segments ↔ model objects ──
  const dsByFile = (f) => p.datasets.find((d) => F(d.name) === f) || null;
  const gByFile = (f) => p.diagrams.find((g) => F(g.name) === f) || null;
  const figByFile = (f) => p.figures.find((x) => F(x.name) === f) || null;
  /** a diagram's layers with their file base names (the layer's own name, else its data's; repeats numbered) */
  const layerFiles = (g) => layerBases(p, g);
  const split = (sub) => String(sub).split('/').filter(Boolean);

  /** what a path names: { kind, …objects } or null */
  function locate(sub) {
    const s = split(sub);
    if (!s.length) return { kind: 'root' };
    const [top, a, b, c, ...rest] = s;
    if (top === 'project.json' && s.length === 1) return { kind: 'project' };
    if (top === 'data') {
      if (s.length === 1) return { kind: 'dir', name: 'data' };
      const m = s.length === 2 && /^(.*)\.(csv|json)$/.exec(a); if (!m) return null;
      const d = dsByFile(m[1]); return d ? { kind: m[2] === 'csv' ? 'data' : 'datameta', d } : null;
    }
    if (top === 'diagrams') {
      if (s.length === 1) return { kind: 'dir', name: 'diagrams' };
      const g = gByFile(a); if (!g) return null;
      if (s.length === 2) return { kind: 'diagram', g };
      if (s.length === 3 && b === 'diagram.json') return { kind: 'diagramjson', g };
      if (s.length === 3 && b === `${g.kind}.svg`) return { kind: 'svg', g };
      if (b !== 'layers' || rest.length) return null;
      if (s.length === 3) return { kind: 'layers', g };
      const m = /^(.*)\.(csv|json)$/.exec(c); if (!m) return null;
      const hit = layerFiles(g).find((x) => x.base === m[1]);
      return hit ? { kind: m[2] === 'csv' ? 'layerlink' : 'layerjson', g, l: hit.l } : null;
    }
    if (top === 'figures') {
      if (s.length === 1) return { kind: 'dir', name: 'figures' };
      const m = s.length === 2 && /^(.*)\.(compo\.json|pdf)$/.exec(a); if (!m) return null;
      const f = figByFile(m[1]); return f ? { kind: m[2] === 'pdf' ? 'pdf' : 'figure', f } : null;
    }
    if (top === 'selection') {
      if (s.length === 1) return { kind: 'dir', name: 'selection' };
      const m = s.length === 2 && /^(.*)\.(rows|csv)$/.exec(a); if (!m) return null;
      const d = dsByFile(m[1]); return d ? { kind: m[2] === 'rows' ? 'selrows' : 'selcsv', d } : null;
    }
    if (top === 'field') {                                   // originals: read-only, byte for byte
      if (s.length === 1) return { kind: 'dir', name: 'field' };
      const o = p.originals.find((x) => F(x.name) === a); if (!o) return null;
      if (s.length === 2) return { kind: 'original', o };
      if (s.length === 3 && b === F(o.file)) return { kind: 'origfile', o, bytes: o.bytes };
      if (s.length === 3 && b === `${F(o.file)}.sig` && o.sig) return { kind: 'origfile', o, bytes: o.sig };
      if (b !== 'photos' || !o.photos.length || rest.length) return null;
      if (s.length === 3) return { kind: 'photos', o };
      const ph = o.photos.find((x) => F(x.name) === c); return ph ? { kind: 'origfile', o, bytes: ph.bytes } : null;
    }
    return null;
  }
  const need = (sub) => { const n = locate(sub); if (!n) throw err('ENOENT', sub); return n; };
  const isDir = (n) => ['root', 'dir', 'diagram', 'layers', 'original', 'photos'].includes(n.kind);
  const linkTarget = (l) => `../../../data/${F(p.dataset(l.datasetId).name)}.csv`;

  // ── reading ──
  async function content(n, sub) {
    switch (n.kind) {
      case 'project': return json({ name: p.name, datasets: p.datasets.length, diagrams: p.diagrams.length, layers: p.layers.length, figures: p.figures.length, originals: p.originals.length,
        active: p.diagram(p.activeDiagram)?.name || null });
      case 'data': case 'layerlink': { const d = n.d || p.dataset(n.l.datasetId); return toCsv(d.columns, d.rows); }
      case 'datameta': { const d = n.d; return json({ name: d.name, kind: d.kind, rows: d.rows.length, columns: d.columns, roles: d.roles, notation: d.notation, lineage: d.lineage,
        drawnOn: p.usesOf(d.id).map((u) => u.diagramName) }); }
      case 'diagramjson': return json({ name: n.g.name, kind: n.g.kind, props: n.g.props, layers: layerFiles(n.g).map((x) => x.base) });
      case 'svg': { const s = renderSvg ? renderSvg(n.g.id) : null; if (s == null) throw err('ENOENT', sub, 'not drawn yet'); return s; }
      case 'layerjson': return json({ data: p.dataset(n.l.datasetId).name, name: n.l.name, visible: n.l.visible, style: n.l.style, elements: n.l.elements });
      case 'figure': return json(n.f.doc);
      case 'pdf': { if (!figurePdf) throw err('ENOTSUP', sub, 'no PDF export here'); return await figurePdf(n.f.id); }
      case 'selrows': return p.selected(n.d.id).map((i) => i + 1).join('\n') + (p.selected(n.d.id).length ? '\n' : '');
      case 'selcsv': return toCsv(n.d.columns, p.selected(n.d.id).map((i) => n.d.rows[i]));
      case 'origfile': return n.bytes;
      default: throw err('EISDIR', sub);
    }
  }
  const bytes = (c) => (c instanceof Uint8Array ? c : enc.encode(c));
  const text = (c) => (typeof c === 'string' ? c : c instanceof Uint8Array ? dec.decode(c) : String(c ?? ''));
  const statOf = (type, size) => ({ type, size, created: mtime, modified: mtime, accessed: mtime, mode: type === 'directory' ? 0o755 : 0o644 });

  // ── writing (each a model call, so each is one undo step) ──
  function write(sub, data) {
    const s = split(sub), n = locate(sub), t = text(data);
    if (n) switch (n.kind) {
      case 'data': case 'layerlink': {
        const d = n.d || p.dataset(n.l.datasetId), tbl = parseDelimited(t);
        p.editRows(d.id, () => tbl.rows); return;
      }
      case 'diagramjson': {
        const o = JSON.parse(t);
        p.batch('diagram settings', () => { if (o.name && o.name !== n.g.name) p.renameDiagram(n.g.id, o.name); if (o.props) p.setDiagramProps(n.g.id, o.props); });
        return;
      }
      case 'layerjson': {
        const o = JSON.parse(t), L = n.l;
        p.batch('layer settings', () => {
          if (o.visible != null && !!o.visible !== L.visible) p.setLayerVisible(L.id, o.visible);
          if (o.style) p.setLayerStyle(L.id, o.style);
          for (const [name, v] of Object.entries(o.elements || {})) if (v && typeof v === 'object') p.setElementSettings(L.id, name, v);
        });
        return;
      }
      case 'figure': p.setFigureDoc(n.f.id, JSON.parse(t)); return;
      case 'selrows': {
        const rows = t.split(/[\s,]+/).filter(Boolean).map(Number);
        if (rows.some((r) => !Number.isInteger(r) || r < 1 || r > n.d.rows.length)) throw err('EINVAL', sub, `row numbers run 1–${n.d.rows.length}`);
        p.select(n.d.id, rows.map((r) => r - 1)); return;
      }
      case 'origfile': throw err('EACCES', sub, 'an original is kept exactly as it came (its signature is over these bytes) — edit the data read from it, in data/');
      default: throw err('EACCES', sub, 'read-only');
    }
    if (s[0] === 'field') throw err('EACCES', sub, 'field/ holds originals as they came — open a field log to add one');
    // a new file
    if (s.length === 2 && s[0] === 'data' && /\.csv$/i.test(s[1])) {
      const name = s[1].replace(/\.csv$/i, '').replace(/∕/g, '/');
      const specs = readTable(t, name);
      if (!specs.length) throw err('EINVAL', sub, 'no attitudes in it');
      p.batch(`new data ${name}`, () => { for (const spec of specs) p.addDataset(spec); });
      return;
    }
    if (s.length === 2 && s[0] === 'figures' && /\.compo\.json$/.test(s[1])) { p.addFigure({ name: s[1].replace(/\.compo\.json$/, '').replace(/∕/g, '/'), doc: JSON.parse(t) }); return; }
    throw err('EACCES', sub, 'nothing can be made here');
  }

  /** remove what a path names: the model's rules decide */
  function remove(sub, { recursive = false } = {}) {
    const n = need(sub);
    switch (n.kind) {
      case 'data': try { p.removeDataset(n.d.id); return; } catch (e) { throw err('EBUSY', sub, `${e.message} — remove those layers first`); }
      case 'layerlink': case 'layerjson': p.removeLayer(n.l.id); return;
      case 'figure': p.removeFigure(n.f.id); return;
      case 'selrows': p.clearSelection(n.d.id); return;
      case 'diagram': if (!recursive) throw err('ENOTEMPTY', sub); p.removeDiagram(n.g.id); return;
      case 'layers': if (!recursive) { if (p.layersOf(n.g.id).length) throw err('ENOTEMPTY', sub); return; }
        p.batch('remove layers', () => { for (const l of p.layersOf(n.g.id)) p.removeLayer(l.id); }); return;
      case 'datameta': throw err('EACCES', sub, `the data is ${sub.replace(/\.json$/, '.csv')}`);
      case 'original': if (!recursive) throw err('ENOTEMPTY', sub); p.removeOriginal(n.o.id); return;   // the whole original or nothing
      case 'origfile': case 'photos': throw err('EACCES', sub, 'an original goes whole (rm -r field/<name>) or not at all');
      default: throw err('EACCES', sub, 'this can only go with what it belongs to');
    }
  }

  /** resolve a symlink target written relative to the link's directory (or absolute, under the mount) */
  function resolveTarget(linkSub, target) {
    const parts = target.startsWith('/') ? split(target.startsWith(mount + '/') ? target.slice(mount.length) : target) : [...split(linkSub).slice(0, -1), ...split(target)];
    const out = []; for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
    return '/' + out.join('/');
  }

  return {
    // a recursive rm reaches us in ONE call (the VFS's native path), so removing a diagram removes it
    // through the model instead of unlinking its files one by one
    recursiveRemove: true,
    symlinks: true,        // layers are symlinks to their data

    async readFile(sub, encoding) { const n = need(sub); const c = await content(n, sub); return encoding === 'bytes' ? bytes(c) : text(c); },
    async readRange(sub, offset, length) { return (await this.readFile(sub, 'bytes')).subarray(offset, offset + length); },
    async writeFile(sub, data) { write(sub, data); },
    async stat(sub) {
      const n = need(sub);
      if (isDir(n)) return statOf('directory', 0);
      if (n.kind === 'pdf') return statOf('file', 0);
      return statOf('file', bytes(await content(n, sub)).byteLength);
    },
    async lstat(sub) {
      const n = need(sub);
      if (n.kind === 'layerlink') return { ...statOf('symlink', linkTarget(n.l).length), target: linkTarget(n.l) };
      return this.stat(sub);
    },
    async readlink(sub) { const n = need(sub); if (n.kind !== 'layerlink') throw err('EINVAL', sub, 'not a link'); return linkTarget(n.l); },
    async exists(sub) { return !!locate(sub); },
    async readdir(sub) {
      const n = need(sub);
      switch (n.kind) {
        case 'root': return ['data', 'diagrams', 'field', 'figures', 'project.json', 'selection'];
        case 'original': return [F(n.o.file), ...(n.o.sig ? [`${F(n.o.file)}.sig`] : []), ...(n.o.photos.length ? ['photos'] : [])].sort();
        case 'photos': return n.o.photos.map((x) => F(x.name)).sort();
        case 'dir':
          if (n.name === 'field') return p.originals.map((o) => F(o.name)).sort();
          if (n.name === 'data') return p.datasets.flatMap((d) => [`${F(d.name)}.csv`, `${F(d.name)}.json`]).sort();
          if (n.name === 'diagrams') return p.diagrams.map((g) => F(g.name)).sort();
          if (n.name === 'figures') return p.figures.flatMap((f) => [`${F(f.name)}.compo.json`, ...(figurePdf ? [`${F(f.name)}.pdf`] : [])]).sort();
          return p.datasets.flatMap((d) => [`${F(d.name)}.csv`, `${F(d.name)}.rows`]).sort();
        case 'diagram': return ['diagram.json', 'layers', ...(renderSvg ? [`${n.g.kind}.svg`] : [])].sort();
        case 'layers': return layerFiles(n.g).flatMap((x) => [`${x.base}.csv`, `${x.base}.json`]).sort();
        default: throw err('ENOTDIR', sub);
      }
    },
    async mkdir(sub, opts) {
      const s = split(sub);
      if (s.length === 2 && s[0] === 'diagrams') {
        if (gByFile(s[1])) { if (opts?.recursive) return; throw err('EEXIST', sub); }
        p.addDiagram('net', { name: s[1].replace(/∕/g, '/') }); return;
      }
      if (opts?.recursive && locate(sub) && isDir(locate(sub))) return;
      throw err('EACCES', sub, 'only a diagram can be made here (mkdir diagrams/<name>)');
    },
    async unlink(sub) { const n = need(sub); if (isDir(n)) throw err('EISDIR', sub); remove(sub); },
    async rmdir(sub, opts) { remove(sub, { recursive: !!opts?.recursive }); },
    async symlink(target, sub) {
      const s = split(sub);
      if (!(s.length === 4 && s[0] === 'diagrams' && s[2] === 'layers')) throw err('EACCES', sub, 'links are layers: diagrams/<name>/layers/<layer>.csv');
      const g = gByFile(s[1]); if (!g) throw err('ENOENT', sub, 'no such diagram');
      const t = locate(resolveTarget(sub, target));
      if (!t || t.kind !== 'data') throw err('EINVAL', sub, `a layer links to data/<name>.csv (got ${target})`);
      const name = s[3].replace(/\.csv$/i, '').replace(/∕/g, '/'), first = p.layers.find((l) => l.datasetId === t.d.id);
      p.batch('add layer', () => {
        const id = first ? p.addView(first.id, g.id) : p.addLayer(g.id, t.d.id);
        if (name && name !== t.d.name) { p.layer(id).name = name; p._emit('layer-changed', { id }); }   // the link's own name names the layer (inside the step)
      });
    },
    async rename(from, to) {
      const n = need(from), s = split(to);
      if (n.kind === 'data' && s.length === 2 && s[0] === 'data' && /\.csv$/.test(s[1])) { p.renameDataset(n.d.id, s[1].replace(/\.csv$/, '').replace(/∕/g, '/')); return; }
      if (n.kind === 'diagram' && s.length === 2 && s[0] === 'diagrams') { p.renameDiagram(n.g.id, s[1].replace(/∕/g, '/')); return; }
      if (n.kind === 'figure' && s.length === 2 && s[0] === 'figures' && /\.compo\.json$/.test(s[1])) { p.renameFigure(n.f.id, s[1].replace(/\.compo\.json$/, '').replace(/∕/g, '/')); return; }
      if ((n.kind === 'layerlink' || n.kind === 'layerjson') && s.length >= 3 && s[0] === 'diagrams' && s[2] === 'layers') {
        const g = gByFile(s[1]); if (!g) throw err('ENOENT', to, 'no such diagram');
        if (g.id !== n.l.diagramId) p.moveLayer(n.l.id, g.id); return;
      }
      throw err('EACCES', from, `can't become ${to}`);
    },
  };
}
