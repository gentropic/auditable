// micro — a minimal WebM (Matroska) writer for one video track of VP8/VP9 frames
// from WebCodecs' VideoEncoder. Every frame carries its own timestamp, so a video
// whose frames took seconds each to render still plays at exactly its frame rate —
// what a real-time recorder can't promise on a busy machine. EBML header, Segment
// (Info with the duration, Tracks, Cues for seeking), Clusters of SimpleBlocks;
// sizes are known (the whole file is built in memory), timestamps in milliseconds.

const te = new TextEncoder();
const idBytes = (id) => { const out = []; let v = id; while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); } return out; };
// an EBML size as an 8-byte vint (0x01 + 7 bytes): simple, always valid
const size8 = (n) => { const b = [0x01]; for (let k = 6; k >= 0; k--) b.push(Math.floor(n / 2 ** (8 * k)) & 0xff); return b; };
const uint = (v) => { if (v === 0) return [0]; const b = []; while (v > 0) { b.unshift(v & 0xff); v = Math.floor(v / 256); } return b; };
const float64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return [...b]; };
const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const el = (id, payload) => { const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload); return concat([Uint8Array.from(idBytes(id)), Uint8Array.from(size8(body.length)), body]); };
const elUint = (id, v) => el(id, uint(v));
const elStr = (id, s) => el(id, te.encode(s));
const elFloat = (id, v) => el(id, float64(v));
const master = (id, children) => el(id, concat(children));

/**
 * frames: [{ data: Uint8Array, ts: ms, key: bool }] in decode order; codec 'vp8' | 'vp9'.
 * → Uint8Array of a WebM file.
 */
export function muxWebm({ width, height, codec = 'vp8', frames, durationMs, app = 'micro' }) {
  const header = master(0x1A45DFA3, [elUint(0x4286, 1), elUint(0x42F7, 1), elUint(0x42F2, 4), elUint(0x42F3, 8), elStr(0x4282, 'webm'), elUint(0x4287, 4), elUint(0x4285, 2)]);
  const info = master(0x1549A966, [elUint(0x2AD7B1, 1000000), elStr(0x4D80, app), elStr(0x5741, app), elFloat(0x4489, durationMs)]);
  const tracks = master(0x1654AE6B, [master(0xAE, [elUint(0xD7, 1), elUint(0x73C5, 1), elUint(0x83, 1), elUint(0x9C, 0), elStr(0x86, codec === 'vp9' ? 'V_VP9' : 'V_VP8'),
    master(0xE0, [elUint(0xB0, width), elUint(0xBA, height)])])]);
  // clusters: a new one at each key frame, and at least every 30 s (the int16 offset)
  const clusters = [];
  let cur = null;
  const flush = () => { if (cur) { clusters.push({ t: cur.t, body: master(0x1F43B675, [elUint(0xE7, cur.t), ...cur.blocks]) }); cur = null; } };
  for (const f of frames) {
    const t = Math.round(f.ts);
    if (!cur || f.key || t - cur.t > 30000) { flush(); cur = { t, blocks: [] }; }
    const rel = t - cur.t;
    const blk = new Uint8Array(4 + f.data.length);
    blk[0] = 0x81; blk[1] = (rel >> 8) & 0xff; blk[2] = rel & 0xff; blk[3] = f.key ? 0x80 : 0x00;
    blk.set(f.data, 4);
    cur.blocks.push(el(0xA3, blk));
  }
  flush();
  // cues: where each cluster starts, relative to the segment's data
  const cuesFor = (offsets) => master(0x1C53BB6B, clusters.map((c, k) => master(0xBB, [elUint(0xB3, c.t), master(0xB7, [elUint(0xF7, 1), elUint(0xF1, offsets[k])])])));
  const pre = info.length + tracks.length;
  let cues = cuesFor(clusters.map(() => 0));
  for (let pass = 0; pass < 3; pass++) {                    // cue sizes depend on the offsets they hold: settle
    let at = pre + cues.length; const offs = clusters.map((c) => { const o = at; at += c.body.length; return o; });
    const next = cuesFor(offs);
    if (next.length === cues.length) { cues = next; break; }
    cues = next;
  }
  const segment = master(0x18538067, [info, tracks, cues, ...clusters.map((c) => c.body)]);
  return concat([header, segment]);
}

/** Can this browser encode frames itself (WebCodecs)? Resolves to a codec string or null. */
export async function webcodecsCodec(width, height) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of ['vp8', 'vp09.00.10.08']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 4e6, framerate: 30 });
      if (s && s.supported) return codec;
    } catch { /* try the next */ }
  }
  return null;
}
