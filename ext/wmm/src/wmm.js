// @gcu/wmm — the World Magnetic Model, evaluated.
//
// Geodetic position + date → the main field (X north, Y east, Z down; nT), its
// derived elements (H, F, inclination I, declination D, grid variation GV) and
// their secular variation. The equations are the WMM technical report's
// (NOAA/NCEI; §"The model"): a degree-12 spherical-harmonic expansion of the
// geomagnetic potential in Schmidt semi-normalized associated Legendre
// functions, evaluated in geocentric spherical coordinates and rotated back
// to the geodetic frame. Coefficients come from the official COF file
// (coefficients.js, generated — never hand-typed) and the twelve published
// test points pin the implementation (test/wmm.test.mjs).
//
// The one number a compass wants is `declination(lat, lon, date)`: add it to a
// magnetic azimuth to get true (east-positive, bearing's convention).
import { COEFFICIENTS, DEGREE, EPOCH, MODEL } from './coefficients.js';

const DEG = Math.PI / 180;
const A_WGS84 = 6378.137;                 // km, semi-major axis
const F_WGS84 = 1 / 298.257223563;        // flattening
const E2 = F_WGS84 * (2 - F_WGS84);       // first eccentricity squared
const A_REF = 6371.2;                     // km, the geomagnetic reference radius

// coefficient tables indexed [n][m]
const G = [], H = [], GD = [], HD = [];
for (let n = 0; n <= DEGREE; n++) { G.push(new Float64Array(n + 1)); H.push(new Float64Array(n + 1)); GD.push(new Float64Array(n + 1)); HD.push(new Float64Array(n + 1)); }
for (const [n, m, g, h, gd, hd] of COEFFICIENTS) { G[n][m] = g; H[n][m] = h; GD[n][m] = gd; HD[n][m] = hd; }

/** A Date (or a decimal year) → decimal year, e.g. 2027-07-02 → 2027.5. */
export function decimalYear(date = new Date()) {
  if (typeof date === 'number') return date;
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), next = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (next - start);
}

/** Model validity: [epoch, epoch + 5). Outside it the model still evaluates, with `valid: false`. */
export const VALID_FROM = EPOCH;
export const VALID_TO = EPOCH + 5;
export { EPOCH, MODEL };

/**
 * Evaluate the field at geodetic latitude/longitude (degrees), height above the
 * WGS84 ellipsoid (km) and a date (Date or decimal year).
 * → { x, y, z, h, f, incl, decl, gv, xdot, ydot, zdot, hdot, fdot, idot, ddot, year, valid }
 *   nT and nT/yr; angles in degrees, rates in deg/yr. `gv` is null outside |lat| > 55°.
 */
export function field(lat, lon, { height = 0, date = new Date() } = {}) {
  const year = decimalYear(date);
  const dt = year - EPOCH;
  const phi = lat * DEG, lam = lon * DEG;

  // geodetic → geocentric spherical (r, phi')
  const sphi = Math.sin(phi), cphi = Math.cos(phi);
  const rc = A_WGS84 / Math.sqrt(1 - E2 * sphi * sphi);
  const p = (rc + height) * cphi;
  const zc = (rc * (1 - E2) + height) * sphi;
  const r = Math.hypot(p, zc);
  const phic = Math.atan2(zc, p);
  const psi = phic - phi;

  // Schmidt semi-normalized P[n][m](x) and dP/dθ, x = sin φ' = cos θ, s = sin θ
  const x = Math.sin(phic), s = Math.cos(phic);
  const P = [], DP = [];
  for (let n = 0; n <= DEGREE; n++) { P.push(new Float64Array(n + 1)); DP.push(new Float64Array(n + 1)); }
  P[0][0] = 1; DP[0][0] = 0;
  for (let n = 1; n <= DEGREE; n++) {
    for (let m = 0; m <= n; m++) {
      if (m === n) {
        if (n === 1) { P[1][1] = s; DP[1][1] = x; }
        else {
          const k = Math.sqrt((2 * n - 1) / (2 * n));
          P[n][n] = k * s * P[n - 1][n - 1];
          DP[n][n] = k * (x * P[n - 1][n - 1] + s * DP[n - 1][n - 1]);
        }
      } else {
        const d = Math.sqrt(n * n - m * m);
        const q = n - 1 > m - 1 && n >= 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
        const p1 = P[n - 1][m], dp1 = DP[n - 1][m];
        const p2 = n >= 2 && m <= n - 2 ? P[n - 2][m] : 0;
        const dp2 = n >= 2 && m <= n - 2 ? DP[n - 2][m] : 0;
        P[n][m] = ((2 * n - 1) * x * p1 - q * p2) / d;
        DP[n][m] = ((2 * n - 1) * (-s * p1 + x * dp1) - q * dp2) / d;
      }
    }
  }

  // sums over the expansion; the derivative wrt φ' is −dP/dθ
  const cml = new Float64Array(DEGREE + 1), sml = new Float64Array(DEGREE + 1);
  for (let m = 0; m <= DEGREE; m++) { cml[m] = Math.cos(m * lam); sml[m] = Math.sin(m * lam); }
  let xp = 0, yp = 0, zp = 0, xpd = 0, ypd = 0, zpd = 0;
  let ar = (A_REF / r) * (A_REF / r);
  for (let n = 1; n <= DEGREE; n++) {
    ar *= A_REF / r;                       // (a/r)^(n+2)
    for (let m = 0; m <= n; m++) {
      const g = G[n][m] + dt * GD[n][m], h = H[n][m] + dt * HD[n][m];
      const gd = GD[n][m], hd = HD[n][m];
      const c = g * cml[m] + h * sml[m], cd = gd * cml[m] + hd * sml[m];
      const sn = g * sml[m] - h * cml[m], snd = gd * sml[m] - hd * cml[m];
      xp += ar * c * DP[n][m];             // −(a/r)^(n+2) · c · dP/dφ'  with dP/dφ' = −dP/dθ
      xpd += ar * cd * DP[n][m];
      yp += ar * m * sn * P[n][m];
      ypd += ar * m * snd * P[n][m];
      zp -= (n + 1) * ar * c * P[n][m];
      zpd -= (n + 1) * ar * cd * P[n][m];
    }
  }
  yp /= s; ypd /= s;                       // 1/cos φ'

  // geocentric → geodetic components
  const cpsi = Math.cos(psi), spsi = Math.sin(psi);
  const X = xp * cpsi - zp * spsi, Z = xp * spsi + zp * cpsi, Y = yp;
  const Xd = xpd * cpsi - zpd * spsi, Zd = xpd * spsi + zpd * cpsi, Yd = ypd;

  const Hh = Math.hypot(X, Y), Ff = Math.hypot(Hh, Z);
  const decl = Math.atan2(Y, X) / DEG, incl = Math.atan2(Z, Hh) / DEG;
  const Hd = (X * Xd + Y * Yd) / Hh, Fd = (X * Xd + Y * Yd + Z * Zd) / Ff;
  const Dd = (X * Yd - Y * Xd) / (Hh * Hh) / DEG, Id = (Hh * Zd - Z * Hd) / (Ff * Ff) / DEG;
  let gv = null;
  if (lat > 55) gv = decl - lon; else if (lat < -55) gv = decl + lon;
  if (gv != null) { gv = ((gv + 180) % 360 + 360) % 360 - 180; }

  return {
    x: X, y: Y, z: Z, h: Hh, f: Ff, incl, decl, gv,
    xdot: Xd, ydot: Yd, zdot: Zd, hdot: Hd, fdot: Fd, idot: Id, ddot: Dd,
    year, valid: year >= VALID_FROM && year < VALID_TO,
  };
}

/** Magnetic declination (degrees, east positive) at a place and date. true = magnetic + declination. */
export function declination(lat, lon, date = new Date(), height = 0) {
  return field(lat, lon, { height, date }).decl;
}
