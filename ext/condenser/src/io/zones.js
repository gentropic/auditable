// ZONE MAPS — per-k-record statistics of a delimited model, for skipping.
//
// A zone is k consecutive RECORDS (the renderer's numbering), the grain of the
// sparse line index, so zone z's bytes are [index.offsets[z], index.offsets[z+1])
// and a reader can seek straight past it. Per zone:
//   numeric column → min, max, and whether a blank may read there;
//   category column → the set of values present (a 256-bit set over the
//   column's dictionary; a column with more than 256 values keeps none).
// Built in the open's discovery pass (every value is read there anyway).
//
// SOUND under every qualifier policy, so a policy change never invalidates them:
// what a cell can read as is covered, whatever the policy says —
//   <x  → 0, x/2, x or blank   ⇒ the range takes in [0, x], and a blank
//   >x  → x or blank            ⇒ x, and a blank
//   −n  → −n, or (negBelow) [0, n] or blank  ⇒ [−n, n], and a blank
//   a code / text / ''          ⇒ a blank
// Coordinates take no qualifier (the row qualifier skips them): just the value.
// A zone with nothing finite keeps min > max — "no stats", it must be read.
import { classifyQualified } from './qualified.js';

const grow = (a, n, Type, fill) => {
  if (a.length >= n) return a;
  const b = new Type(Math.max(n, a.length * 2)); if (fill !== undefined) b.fill(fill); b.set(a); return b;
};

export function createZoneBuilder(columns, { num, coord, k = 1024, catMax = 256 }) {
  const coordSet = new Set(coord);
  const nums = [...num].map((i) => ({ i, name: columns[i], coord: coordSet.has(i), min: new Float64Array(64).fill(Infinity), max: new Float64Array(64).fill(-Infinity), blank: new Uint8Array(64) }));
  const numSet = new Set(num);
  const cats = columns.map((name, i) => i).filter((i) => !numSet.has(i)).map((i) => ({ i, name: columns[i], dict: new Map(), bits: new Uint32Array(64 * 8), dead: false }));
  let nz = 0;
  const widen = (c, z, x) => { if (x < c.min[z]) c.min[z] = x; if (x > c.max[z]) c.max[z] = x; };
  return {
    // one accepted record's fields (rec = its record number, in order)
    push(f, rec) {
      const z = (rec / k) | 0;
      if (z >= nz) {
        nz = z + 1;
        for (const c of nums) { c.min = grow(c.min, nz, Float64Array, Infinity); c.max = grow(c.max, nz, Float64Array, -Infinity); c.blank = grow(c.blank, nz, Uint8Array); }
        for (const c of cats) if (!c.dead) c.bits = grow(c.bits, nz * 8, Uint32Array);
      }
      for (let q = 0; q < nums.length; q++) {
        const c = nums[q], v = f[c.i];
        const x = typeof v === 'number' ? v : v == null || v === '' ? NaN : +v;
        if (x === x && x !== Infinity && x !== -Infinity) {
          widen(c, z, x);
          if (x < 0 && !c.coord) { widen(c, z, -x); widen(c, z, 0); c.blank[z] = 1; }
          continue;
        }
        c.blank[z] = 1;
        if (c.coord || v == null || v === '') continue;
        const cq = classifyQualified(v);
        if (cq.kind === 'below') { widen(c, z, 0); widen(c, z, cq.v); }
        else if (cq.kind === 'above') widen(c, z, cq.v);
      }
      for (let q = 0; q < cats.length; q++) {
        const c = cats[q];
        if (c.dead) continue;
        const v = f[c.i] == null ? '' : String(f[c.i]);
        let code = c.dict.get(v);
        if (code === undefined) {
          if (c.dict.size >= catMax) { c.dead = true; c.bits = null; c.dict = null; continue; }
          code = c.dict.size; c.dict.set(v, code);
        }
        c.bits[z * 8 + (code >>> 5)] |= 1 << (code & 31);
      }
    },
    finish(count) {
      const n = Math.ceil(count / k);
      const num = {}, cat = {};
      for (const c of nums) num[c.name] = { min: c.min.slice(0, n), max: c.max.slice(0, n), blank: c.blank.slice(0, n) };
      for (const c of cats) if (!c.dead) cat[c.name] = { dict: [...c.dict.keys()], bits: c.bits.slice(0, n * 8) };
      return { k, n, count, num, cat };
    },
  };
}

// the statistics of zones [z0, z1] (inclusive), as canMatch reads them
// ({ name → { min, max, hasBlank } | { values } }), for the columns in `names`
// (all when omitted)
export function zoneRanges(zones, z0, z1, names = null) {
  const out = {};
  const want = names ? new Set(names.map((s) => String(s).toLowerCase())) : null;
  for (const name in zones.num) {
    if (want && !want.has(name.toLowerCase())) continue;
    const c = zones.num[name];
    let mn = Infinity, mx = -Infinity, bl = false;
    for (let z = z0; z <= z1; z++) { if (c.min[z] < mn) mn = c.min[z]; if (c.max[z] > mx) mx = c.max[z]; if (c.blank[z]) bl = true; }
    out[name] = { min: mn, max: mx, hasBlank: bl };
  }
  for (const name in zones.cat) {
    if (want && !want.has(name.toLowerCase())) continue;
    const c = zones.cat[name], values = [];
    for (let code = 0; code < c.dict.length; code++) {
      const w = code >>> 5, b = 1 << (code & 31);
      for (let z = z0; z <= z1; z++) if (c.bits[z * 8 + w] & b) { values.push(c.dict[code]); break; }
    }
    out[name] = { values };
  }
  return out;
}

// to and from a sidecar (JSON): the arrays as base64 of their bytes
const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s, Type) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Type(u.buffer); };
export function zonesToJSON(zones) {
  if (!zones) return null;
  const num = {}, cat = {};
  for (const n in zones.num) { const c = zones.num[n]; num[n] = { min: b64(c.min), max: b64(c.max), blank: b64(c.blank) }; }
  for (const n in zones.cat) { const c = zones.cat[n]; cat[n] = { dict: c.dict, bits: b64(c.bits) }; }
  return { k: zones.k, n: zones.n, count: zones.count, num, cat };
}
export function zonesFromJSON(j) {
  if (!j || !j.num) return null;
  const num = {}, cat = {};
  for (const n in j.num) { const c = j.num[n]; num[n] = { min: unb64(c.min, Float64Array), max: unb64(c.max, Float64Array), blank: unb64(c.blank, Uint8Array) }; }
  for (const n in j.cat) { const c = j.cat[n]; cat[n] = { dict: c.dict, bits: unb64(c.bits, Uint32Array) }; }
  return { k: j.k, n: j.n, count: j.count, num, cat };
}
