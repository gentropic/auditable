// wuffle — the compass's published log, brought into a project. The field publishes `wuffle-log.csv`, a
// `wuffle-log.csv.sig` (the phone's hardware key signing those EXACT bytes) and one .jpg per photographed
// station. A project keeps all three VERBATIM as an ORIGINAL (model.js) — re-serialising the CSV would break
// the signature — and reads the measurements into ordinary datasets beside it, which can be edited freely.
//
// The signature: { file, alg: 'ECDSA-P256-SHA256', sig: base64 raw r‖s, pub: base64 SPKI, hash: base64
// SHA-256 of the bytes, security: what the phone's keystore said it is, signedAt }. Checking it proves these
// bytes were signed by THAT key and not changed since. Which key is trusted — that it is the phone you
// carried — is the reader's call: we show its fingerprint. The `security` word is the signer's own claim.

import { sniffRoles, parseDelimited } from './io.js';

const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

/** does this text read as a wuffle field log? */
export function isFieldLog(text) {
  try { const t = parseDelimited(text); return sniffRoles(t.columns, t.rows).kind === 'fieldlog'; } catch { return false; }
}

/** the photo file names a field log refers to (its `photo` column) */
export function photoNames(text) {
  const t = parseDelimited(text);
  const col = t.columns.find((c) => c.toLowerCase() === 'photo');
  return col ? [...new Set(t.rows.map((r) => String(r[col] || '').trim()).filter(Boolean))] : [];
}

/** a key's fingerprint: the first 16 hex digits of SHA-256 over its SPKI — enough to recognise a phone */
export async function fingerprint(pubB64) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(pubB64)));
  return hex(d.subarray(0, 8)).replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Check a log's bytes against its .sig bytes →
 *   { state: 'verified' | 'mismatch' | 'unsigned' | 'unreadable', why, security?, signedAt?, key? }
 * Never throws: a bad .sig is an answer ('unreadable'), not an error.
 */
export async function verifyLog(bytes, sigBytes) {
  if (!sigBytes) return { state: 'unsigned', why: 'no signature came with this log' };
  let s;
  try { s = JSON.parse(new TextDecoder().decode(sigBytes)); } catch { return { state: 'unreadable', why: 'the .sig is not JSON' }; }
  if (!s || s.alg !== 'ECDSA-P256-SHA256' || !s.sig || !s.pub) return { state: 'unreadable', why: `the .sig names no algorithm wuffle checks (${s?.alg ?? 'none'})` };
  const info = { security: s.security || 'unknown', signedAt: s.signedAt || null };
  try {
    info.key = await fingerprint(s.pub);
    const key = await crypto.subtle.importKey('spki', unb64(s.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(s.sig), bytes);
    return ok ? { state: 'verified', why: 'the bytes are exactly what the key signed', ...info }
      : { state: 'mismatch', why: 'the bytes are NOT what the key signed — the log was changed after signing, or the .sig belongs to another log', ...info };
  } catch (e) { return { state: 'unreadable', why: `the signature couldn't be checked: ${e.message}`, ...info }; }
}

/** one line for a status bar or the console */
export function describe(v) {
  if (v.state === 'verified') return `signature verified — key ${v.key}${v.security ? `, ${v.security}` : ''}${v.signedAt ? `, signed ${v.signedAt}` : ''}`;
  if (v.state === 'mismatch') return `SIGNATURE DOES NOT MATCH — ${v.why}`;
  if (v.state === 'unsigned') return 'unsigned';
  return `signature not checked — ${v.why}`;
}

/**
 * Dropped files → what they are: field logs gather their .sig and the photos they name; everything else
 * passes through. Files: [{ name, bytes }] (bytes = Uint8Array). → { logs: [{ log, sig, photos }], rest, stray }
 * — `stray` are .sig / .jpg files no log claimed (worth a word to the user, never an error).
 */
export function gather(files) {
  const dec = new TextDecoder(), used = new Set(), logs = [];
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const f of files) {
    if (!/\.(csv|txt)$/i.test(f.name)) continue;
    const text = dec.decode(f.bytes);
    if (!isFieldLog(text)) continue;
    used.add(f);
    // the .sig: by name (wuffle-log.csv.sig; a browser may have renamed both to "wuffle-log (1).csv[.sig]")
    const sig = byName.get(`${f.name}.sig`) || null;
    if (sig) used.add(sig);
    const photos = [];
    for (const n of photoNames(text)) { const p = byName.get(n); if (p) { photos.push(p); used.add(p); } }
    logs.push({ log: f, sig, photos, wanted: photoNames(text).length });
  }
  const rest = files.filter((f) => !used.has(f) && !/\.(sig|jpe?g)$/i.test(f.name));
  const stray = files.filter((f) => !used.has(f) && /\.(sig|jpe?g)$/i.test(f.name));
  return { logs, rest, stray };
}
