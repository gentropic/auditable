// micro KML / KMZ — Google Earth's format, both ways (pure: no DOM, no network).
//
//   readKml(text) → [{ geometry, properties, id }] (poly-io makes it a 'kml' feature model):
//     every Placemark — Point / LineString / LinearRing / Polygon (outer + inner boundaries) /
//     MultiGeometry (nested) — with its name, description, the Folder it sits in, and its
//     ExtendedData (<Data name><value> and <SchemaData><SimpleData name>) as attributes.
//     Coordinates are lon,lat[,alt] — ALWAYS WGS 84 (the caller reprojects into the project's
//     CRS). An altitude counts as z only when the geometry is absolute (altitudeMode absolute);
//     clamped / relative ones read as 2D (z = 0, the caller places them).
//   await kmlInZip(blob, name) → the KML text inside a .kmz (doc.kml, else the first .kml)
//   featuresToKml(items, { name }) → KML text. items: [{ name, attrs, geometry (GeoJSON-shaped,
//     in lon/lat), kind }] — strings / polygons / points, ExtendedData for every attribute.
import { openZipRanged, blobSource } from '../../../ext/archive/src/zipstream.js';

// ── a small XML reader: elements { tag, attrs, children, text } (namespaces stripped) ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += unent(text.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += unent(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); stack[stack.length - 1].text += text.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = text.indexOf('>', lt);
    if (gt < 0) break;
    let body = text.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      const tag = body.slice(1).trim().replace(/^.*:/, '');
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    const self = body.endsWith('/');
    if (self) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) continue;
    const el = { tag: m[1].replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
    for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attrs[a[1].replace(/^.*:/, '')] = unent(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  return root;
}
const kids = (el, tag) => el.children.filter((c) => c.tag === tag);
const kid = (el, tag) => el.children.find((c) => c.tag === tag) || null;
const textOf = (el) => (el ? (el.text + el.children.map(textOf).join('')).trim() : '');
function* descend(el, tag) { for (const c of el.children) { if (c.tag === tag) yield c; yield* descend(c, tag); } }

function coordsOf(el) {
  const c = kid(el, 'coordinates');
  if (!c) return [];
  return textOf(c).split(/\s+/).filter(Boolean).map((t) => t.split(',').map(Number)).filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
const absolute = (el) => { const m = kid(el, 'altitudeMode') || kid(el, 'gx:altitudeMode'); return m ? /^absolute$/i.test(textOf(m)) : false; };
const P = (p, abs) => (abs && p.length > 2 ? [p[0], p[1], p[2]] : [p[0], p[1]]);

// a KML geometry element → GeoJSON-shaped geometries (MultiGeometry flattens to its members)
function geometriesOf(el) {
  const out = [];
  for (const g of el.children) {
    const abs = absolute(g);
    if (g.tag === 'Point') { const c = coordsOf(g); if (c.length) out.push({ type: 'Point', coordinates: P(c[0], abs) }); }
    else if (g.tag === 'LineString') { const c = coordsOf(g); if (c.length >= 2) out.push({ type: 'LineString', coordinates: c.map((p) => P(p, abs)) }); }
    else if (g.tag === 'LinearRing') { const c = coordsOf(g); if (c.length >= 3) out.push({ type: 'Polygon', coordinates: [c.map((p) => P(p, abs))] }); }
    else if (g.tag === 'Polygon') {
      const ring = (b) => { const lr = b && kid(b, 'LinearRing'); return lr ? coordsOf(lr).map((p) => P(p, abs)) : []; };
      const outer = ring(kid(g, 'outerBoundaryIs'));
      if (outer.length >= 3) out.push({ type: 'Polygon', coordinates: [outer, ...kids(g, 'innerBoundaryIs').map(ring).filter((r) => r.length >= 3)] });
    } else if (g.tag === 'MultiGeometry') out.push(...geometriesOf(g));
  }
  return out;
}
function collapse(geoms) {
  if (!geoms.length) return null;
  if (geoms.length === 1) return geoms[0];
  const t = geoms[0].type;
  if (geoms.every((g) => g.type === t)) {
    if (t === 'Polygon') return { type: 'MultiPolygon', coordinates: geoms.map((g) => g.coordinates) };
    if (t === 'LineString') return { type: 'MultiLineString', coordinates: geoms.map((g) => g.coordinates) };
    if (t === 'Point') return { type: 'MultiPoint', coordinates: geoms.map((g) => g.coordinates) };
  }
  return { type: 'GeometryCollection', geometries: geoms };
}

export function readKml(text) {
  const root = parseXml(String(text || '').replace(/^﻿/, ''));
  const list = [];
  let n = 0;
  const walk = (el, folder) => {
    for (const c of el.children) {
      if (c.tag === 'Folder' || c.tag === 'Document') { const nm = textOf(kid(c, 'name')); walk(c, c.tag === 'Folder' ? (folder ? `${folder}/${nm}` : nm) : folder); }
      else if (c.tag === 'Placemark') {
        const props = { name: textOf(kid(c, 'name')) };
        if (folder) props.folder = folder;
        const ed = kid(c, 'ExtendedData');
        if (ed) {
          for (const d of kids(ed, 'Data')) props[d.attrs.name || `data${Object.keys(props).length}`] = textOf(kid(d, 'value'));
          for (const sd of descend(ed, 'SimpleData')) props[sd.attrs.name || `field${Object.keys(props).length}`] = textOf(sd);
        }
        const desc = textOf(kid(c, 'description'));
        if (desc && !ed) props.description = desc;
        const geometry = collapse(geometriesOf(c));
        list.push({ geometry, properties: props, id: ++n });
      } else if (c.tag === 'kml' || c.tag === '#root') walk(c, folder);
    }
  };
  walk(root, '');
  if (!list.length) throw new Error('KML: no Placemarks in this file');
  return list;                                             // poly-io's modelFromGeoFeatures makes the model
}
export const looksKml = (head) => /<kml[\s>]/i.test(head);

export async function kmlInZip(blob, name = 'file.kmz') {
  const z = await openZipRanged(blobSource(blob));
  const all = z.list().filter((e) => !e.dir && /\.kml$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
  const e = all.find((x) => /(^|\/)doc\.kml$/i.test(x.name)) || all[0];
  if (!e) throw new Error(`${name}: no .kml inside this .kmz`);
  return new TextDecoder().decode(await z.bytes(e));
}

// ── writing ──
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => String(+(+v).toFixed(8));
const coordText = (pts, z) => pts.map((p) => `${num(p[0])},${num(p[1])}${z ? ',' + num(p[2] || 0) : ''}`).join(' ');
function geomKml(g, z) {
  const mode = z ? '<altitudeMode>absolute</altitudeMode>' : '';
  const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
  if (g.type === 'Point') return `<Point>${mode}<coordinates>${coordText([g.coordinates], z)}</coordinates></Point>`;
  if (g.type === 'LineString') return `<LineString>${mode}<coordinates>${coordText(g.coordinates, z)}</coordinates></LineString>`;
  if (g.type === 'Polygon') return `<Polygon>${mode}<outerBoundaryIs><LinearRing><coordinates>${coordText(closeRing(g.coordinates[0]), z)}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${coordText(closeRing(r), z)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
  const multi = { MultiPolygon: 'Polygon', MultiLineString: 'LineString', MultiPoint: 'Point' }[g.type];
  if (multi) return `<MultiGeometry>${g.coordinates.map((c) => geomKml({ type: multi, coordinates: c }, z)).join('')}</MultiGeometry>`;
  if (g.type === 'GeometryCollection') return `<MultiGeometry>${g.geometries.map((x) => geomKml(x, z)).join('')}</MultiGeometry>`;
  return '';
}
export function featuresToKml(items, { name = 'micro', z = true } = {}) {
  const pm = items.map((it, i) => {
    const attrs = it.attrs || {};
    const nm = it.name != null && it.name !== '' ? it.name : attrs.name ?? attrs.NAME ?? attrs.Name ?? `${i + 1}`;
    const ed = Object.keys(attrs).length ? `<ExtendedData>${Object.entries(attrs).map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>` : '';
    return `<Placemark><name>${esc(nm)}</name>${ed}${geomKml(it.geometry, z)}</Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>\n${pm.join('\n')}\n</Document></kml>\n`;
}
