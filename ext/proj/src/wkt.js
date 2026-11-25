// @gcu/proj wkt — a CRS → the WKT1 a shapefile's .prj carries, ESRI-flavoured (what ArcGIS
// writes and QGIS / GDAL read): ESRI names (GCS_ / D_ / GRS_1980 / Transverse_Mercator /
// False_Easting …), plus — for a system the EPSG table names — the top-level
// AUTHORITY["EPSG", n] that GDAL / QGIS / this package resolve exactly (an ESRI .prj has no
// code, so without it a reader is left matching names).
//
//   crsToPrj(crs) → { text, why }    text = the WKT, or null with `why` (a reason a person can
//                                    read) when the system can't be said in WKT1 honestly
//
// Generated from the CRS's proj4 definition — the table carries proj4, not WKT (epsg-index's
// WKT for 6,983 systems would multiply the bundle). Covered: geographic (longlat), Transverse
// Mercator (tmerc, utm), Lambert Conformal Conic (1SP and 2SP), Albers, polar stereographic
// (variants A and B), Mercator (1SP with k = 1, and 2SP), Polyconic, Lambert Azimuthal Equal
// Area, Cassini, Equidistant Cylindrical. Refused (null + why): any other projection; axis
// orders other than east/north; and, for a CUSTOM system only (no EPSG code to stand for
// it), a datum shift by grid (+nadgrids) — WKT1 has no place for one. A custom system that is
// already WKT1 is returned as it is (it was a .prj to begin with).
import { proj4 } from './vendor-proj4.js';

// proj4 ellipsoid codes → ESRI spheroid names (the numbers always come from proj4 itself)
const ESRI_ELLPS = {
  GRS80: 'GRS_1980', WGS84: 'WGS_1984', WGS72: 'WGS_1972', intl: 'International_1924', aust_SA: 'GRS_1967_Truncated',
  GRS67: 'GRS_1967', clrk66: 'Clarke_1866', clrk80: 'Clarke_1880_RGS', clrk80ign: 'Clarke_1880_IGN', bessel: 'Bessel_1841',
  bess_nam: 'Bessel_Namibia', krass: 'Krasovsky_1940', airy: 'Airy_1830', mod_airy: 'Airy_Modified', helmert: 'Helmert_1906',
  evrst30: 'Everest_1830', evrst48: 'Everest_Modified_1948', evrstSS: 'Everest_1830_Modified', 'IAU76': 'IAU_1976', sphere: 'Sphere',
  fschr60m: 'Fischer_Modified', hough: 'Hough_1960', andrae: 'Andrae', danish: 'Andrae', plessis: 'Plessis_1817', NWL9D: 'NWL_9D',
};
const DATUM_ELLPS = { WGS84: 'WGS84', NAD83: 'GRS80', NAD27: 'clrk66', potsdam: 'bessel', carthage: 'clrk80ign', hermannskogel: 'bessel', ire65: 'mod_airy', nzgd49: 'intl', OSGB36: 'airy' };
const PM_DEG = { greenwich: 0, lisbon: -9.131906111111, paris: 2.337229166667, bogota: -74.080916666667, madrid: -3.687938888889, rome: 12.452333333333, bern: 7.439583333333, jakarta: 106.807719444444, ferro: -17.666666666667, brussels: 4.367975, stockholm: 18.058277777778, athens: 23.7163375, oslo: 10.722916666667 };

/** a proj4 string → { proj, k: { key: value | true } } */
export function parseProj4(def) {
  const k = {};
  for (const tok of String(def || '').trim().split(/\s+/)) {
    const m = /^\+([\w]+)(?:=(.*))?$/.exec(tok); if (!m) continue;
    k[m[1]] = m[2] === undefined ? true : m[2];
  }
  return { proj: k.proj || null, k };
}

const esriName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Unknown';
// a number as WKT writes it: full precision, a decimal point on integers (ESRI style)
// (never an exponent: proj4's WKT reader doesn't take one)
const num = (v) => {
  const x = +v;
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return x.toFixed(1);
  const s = String(x);
  if (!/e/i.test(s)) return s;
  return x.toFixed(Math.min(100, Math.max(0, Math.ceil(-Math.log10(Math.abs(x))) + 17))).replace(/0+$/, '').replace(/\.$/, '.0');
};
const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
const PARAM = (name, v) => `PARAMETER[${q(name)},${num(v)}]`;

function spheroidOf(k, P) {
  const code = k.ellps || (k.datum && DATUM_ELLPS[k.datum]) || null;
  const a = +P.a;
  const rf = !(P.b && Math.abs(P.a - P.b) > 1e-9) ? 0 : Number.isFinite(+P.rf) && +P.rf > 0 ? +P.rf : P.a / (P.a - P.b);   // the defined rf, not one rebuilt from b
  const name = (code && ESRI_ELLPS[code]) || (rf === 0 ? 'Sphere' : code ? esriName(code) : 'Unknown');
  return `SPHEROID[${q(name)},${num(a)},${num(rf)}]`;
}

// the GEOGCS a CRS stands on; datumName = the base geographic system's name
function geogcs(k, P, datumName, { authority = null } = {}) {
  const base = esriName(datumName);
  const dname = /^WGS_?(19)?84$/i.test(base) ? 'WGS_1984' : base;
  let towgs = '';
  if (k.towgs84 && k.towgs84 !== true) {
    const v = String(k.towgs84).split(',').map(Number);
    if (v.some((x) => x !== 0)) towgs = `,TOWGS84[${v.map(num).join(',')}]`;
  }
  const pmName = typeof k.pm === 'string' ? k.pm : 'greenwich';
  const pm = PM_DEG[pmName.toLowerCase()] != null ? PM_DEG[pmName.toLowerCase()] : +pmName;
  const pmLabel = PM_DEG[pmName.toLowerCase()] != null ? pmName[0].toUpperCase() + pmName.slice(1).toLowerCase() : 'Unknown';
  return `GEOGCS[${q('GCS_' + dname)},DATUM[${q('D_' + dname)},${spheroidOf(k, P)}${towgs}],PRIMEM[${q(pmLabel)},${num(pm)}],UNIT["Degree",0.0174532925199433]${authority ? `,AUTHORITY["EPSG",${q(authority)}]` : ''}]`;
}

function unitOf(k, P) {
  const m = +(P.to_meter || 1);
  if (Math.abs(m - 1) < 1e-15) return 'UNIT["Meter",1.0]';
  if (Math.abs(m - 0.3048006096012192) < 1e-15) return 'UNIT["Foot_US",0.3048006096012192]';
  if (Math.abs(m - 0.3048) < 1e-15) return 'UNIT["Foot",0.3048]';
  return `UNIT[${q(k.units ? esriName(k.units) : 'Unit')},${num(m)}]`;
}

// the projection + its parameters, ESRI-named; null = not one we can say
// (False_Easting / False_Northing are in the projection's linear unit; proj4's +x_0 / +y_0 in metres)
function projectionOf(proj, k, toMeter = 1) {
  const f = (x, d = 0) => (x == null || x === true ? d : +x);
  const FE = f(k.x_0) / toMeter, FN = f(k.y_0) / toMeter, lon0 = f(k.lon_0), lat0 = f(k.lat_0), sc = k.k != null ? f(k.k, 1) : f(k.k_0, 1);
  switch (proj) {
    case 'utm': {
      const z = +k.zone; if (!(z >= 1 && z <= 60)) return null;
      return { name: 'Transverse_Mercator', params: [['False_Easting', 500000 / toMeter], ['False_Northing', (k.south ? 10000000 : 0) / toMeter], ['Central_Meridian', z * 6 - 183], ['Scale_Factor', 0.9996], ['Latitude_Of_Origin', 0]] };
    }
    case 'tmerc': case 'etmerc':
      return { name: 'Transverse_Mercator', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Scale_Factor', sc], ['Latitude_Of_Origin', lat0]] };
    case 'lcc': {
      const l1 = f(k.lat_1, lat0), l2 = k.lat_2 != null ? f(k.lat_2) : l1;
      if (l1 === l2) return { name: 'Lambert_Conformal_Conic', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', l1], ['Scale_Factor', sc], ['Latitude_Of_Origin', k.lat_0 != null ? lat0 : l1]] };
      if (sc !== 1) return null;
      return { name: 'Lambert_Conformal_Conic', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', l1], ['Standard_Parallel_2', l2], ['Latitude_Of_Origin', lat0]] };
    }
    case 'aea':
      return { name: 'Albers', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', f(k.lat_1)], ['Standard_Parallel_2', f(k.lat_2, f(k.lat_1))], ['Latitude_Of_Origin', lat0]] };
    case 'stere': {
      if (Math.abs(Math.abs(lat0) - 90) > 1e-9) return null;                          // oblique stereographic: not here
      if (k.lat_ts != null) return { name: 'Polar_Stereographic', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Scale_Factor', 1], ['Latitude_Of_Origin', f(k.lat_ts)]] };
      return { name: 'Polar_Stereographic', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Scale_Factor', sc], ['Latitude_Of_Origin', lat0]] };
    }
    case 'merc':
      if (k.lat_ts != null && f(k.lat_ts) !== 0) { if (sc !== 1) return null; return { name: 'Mercator', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', f(k.lat_ts)]] }; }
      if (sc !== 1) return null;
      return { name: 'Mercator', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', 0]] };
    case 'poly':
      return { name: 'Polyconic', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Latitude_Of_Origin', lat0]] };
    case 'laea':
      return { name: 'Lambert_Azimuthal_Equal_Area', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Latitude_Of_Origin', lat0]] };
    case 'cass':
      return { name: 'Cassini', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Scale_Factor', 1], ['Latitude_Of_Origin', lat0]] };
    case 'eqc':
      if (lat0 !== 0) return null;
      return { name: 'Equidistant_Cylindrical', params: [['False_Easting', FE], ['False_Northing', FN], ['Central_Meridian', lon0], ['Standard_Parallel_1', f(k.lat_ts)]] };
    default: return null;
  }
}

const PROJ_LABEL = { utm: 'UTM', tmerc: 'Transverse Mercator', lcc: 'Lambert Conformal Conic', aea: 'Albers', stere: 'stereographic', merc: 'Mercator', poly: 'Polyconic', laea: 'Lambert Azimuthal Equal Area', cass: 'Cassini', eqc: 'Equidistant Cylindrical' };

/** A CRS (the table's, or a custom one) → { text: WKT1 for a .prj | null, why: null | reason }. */
export function crsToPrj(crs) {
  if (!crs || !crs.def) return { text: null, why: 'no coordinate system' };
  const def = String(crs.def).trim();
  // a custom system pasted / read as WKT: WKT1 already is a .prj; WKT2 isn't one
  if (/^\s*(PROJCS|GEOGCS)\s*\[/i.test(def)) return { text: def, why: null };
  if (/^\s*[A-Z_]+\s*\[/i.test(def)) return { text: null, why: 'the system is a WKT2 definition — a .prj holds WKT1, and micro does not convert between them' };
  const { proj, k } = parseProj4(def);
  if (!proj) return { text: null, why: 'the definition names no projection' };
  if (k.axis && k.axis !== true && !/^enu?$/i.test(k.axis)) return { text: null, why: `axis order ${k.axis} — an ESRI .prj has no axis order` };
  const epsg = crs.epsg || null;
  if (!epsg && k.nadgrids && k.nadgrids !== '@null') return { text: null, why: `the datum shift is a grid (${k.nadgrids}) — WKT1 has no place for one, and without an EPSG code a reader can't recover it` };
  // a standard parallel on Mercator / Equidistant Cylindrical is right for ArcGIS and GDAL, but
  // proj4's WKT reader puts it in the wrong slot — so micro reading its own file back would be
  // wrong. With an EPSG code the AUTHORITY carries it; without one, refuse
  if (!epsg && (proj === 'merc' || proj === 'eqc') && k.lat_ts != null && +k.lat_ts !== 0) return { text: null, why: `a ${proj === 'merc' ? 'Mercator' : 'Equidistant Cylindrical'} with a standard parallel and no EPSG code — proj4's WKT reader would read it back wrongly` };
  let P;
  try { P = new proj4.Proj(def); } catch (e) { return { text: null, why: `proj4 can't read the definition — ${e && e.message || e}` }; }
  const geographic = /^(longlat|latlong|lonlat|latlon)$/i.test(proj);
  const datumName = crs.datum && !/^ellipsoid /.test(crs.datum) && crs.datum !== 'unknown datum' ? crs.datum : (k.datum || (k.ellps ? `${k.ellps} based` : 'Unknown'));
  if (geographic) return { text: geogcs(k, P, geographicName(crs, datumName), { authority: epsg ? String(epsg) : null }), why: null };
  const pr = projectionOf(proj, k, +(P.to_meter || 1));
  if (!pr) return { text: null, why: `the ${PROJ_LABEL[proj] || proj} projection${proj in PROJ_LABEL ? ' in this form' : ''} isn't one micro writes as a .prj yet` };
  const name = esriName(crs.name || `${datumName} ${PROJ_LABEL[proj] || proj}`);
  const body = [
    q(name), geogcs(k, P, datumName),
    `PROJECTION[${q(pr.name)}]`, ...pr.params.map(([n, v]) => PARAM(n, v)), unitOf(k, P),
  ];
  if (epsg) body.push(`AUTHORITY["EPSG",${q(String(epsg))}]`);
  return { text: `PROJCS[${body.join(',')}]`, why: null };
}
// a geographic system's own name is its datum's (WGS 84 → GCS_WGS_1984)
const geographicName = (crs, datumName) => (crs.epsg ? crs.name : datumName);
