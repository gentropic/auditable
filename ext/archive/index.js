// @gcu/archive — archive format handling for the GCU stack
// Auto-generated from ext/archive/src/ + ext/archive/vendor/ + the built @gcu/bz2 and
// @gcu/lzma bundles — do not edit directly. fflate and fzstd (MIT) vendored at
// ext/archive/vendor/. No Wasm.

// -- vendor/fflate.module.mjs (MIT, see ext/archive/vendor/LICENSE-fflate) --

const fflate = (() => {
// DEFLATE is a complex format; to read this code, you should probably check the RFC first:
// https://tools.ietf.org/html/rfc1951
// You may also wish to take a look at the guide I made about this program:
// https://gist.github.com/101arrowz/253f31eb5abc3d9275ab943003ffecad
// Some of the following code is similar to that of UZIP.js:
// https://github.com/photopea/UZIP.js
// However, the vast majority of the codebase has diverged from UZIP.js to increase performance and reduce bundle size.
// Sometimes 0 will appear where -1 would be more appropriate. This is because using a uint
// is better for memory in most engines (I *think*).
var ch2 = {};
var wk = (function (c, id, msg, transfer, cb) {
    var w = new Worker(ch2[id] || (ch2[id] = URL.createObjectURL(new Blob([
        c + ';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'
    ], { type: 'text/javascript' }))));
    w.onmessage = function (e) {
        var d = e.data, ed = d.$e$;
        if (ed) {
            var err = new Error(ed[0]);
            err['code'] = ed[1];
            err.stack = ed[2];
            cb(err, null);
        }
        else
            cb(null, d);
    };
    w.postMessage(msg, transfer);
    return w;
});

// aliases for shorter compressed code (most minifers don't do this)
var u8 = Uint8Array, u16 = Uint16Array, i32 = Int32Array;
// fixed length extra bits
var fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, /* unused */ 0, 0, /* impossible */ 0]);
// fixed distance extra bits
var fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, /* unused */ 0, 0]);
// code length index map
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
// get base, reverse index map from extra bits
var freb = function (eb, start) {
    var b = new u16(31);
    for (var i = 0; i < 31; ++i) {
        b[i] = start += 1 << eb[i - 1];
    }
    // numbers here are at max 18 bits
    var r = new i32(b[30]);
    for (var i = 1; i < 30; ++i) {
        for (var j = b[i]; j < b[i + 1]; ++j) {
            r[j] = ((j - b[i]) << 5) | i;
        }
    }
    return { b: b, r: r };
};
var _a = freb(fleb, 2), fl = _a.b, revfl = _a.r;
// we can ignore the fact that the other numbers are wrong; they never happen anyway
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0), fd = _b.b, revfd = _b.r;
// map of value to reverse (assuming 16 bits)
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
    // reverse table algorithm from SO
    var x = ((i & 0xAAAA) >> 1) | ((i & 0x5555) << 1);
    x = ((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2);
    x = ((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4);
    rev[i] = (((x & 0xFF00) >> 8) | ((x & 0x00FF) << 8)) >> 1;
}
// create huffman tree from u8 "map": index -> code length for code index
// mb (max bits) must be at most 15
// TODO: optimize/split up?
var hMap = (function (cd, mb, r) {
    var s = cd.length;
    // index
    var i = 0;
    // u16 "map": index -> # of codes with bit length = index
    var l = new u16(mb);
    // length of cd must be 288 (total # of codes)
    for (; i < s; ++i) {
        if (cd[i])
            ++l[cd[i] - 1];
    }
    // u16 "map": index -> minimum code for bit length = index
    var le = new u16(mb);
    for (i = 1; i < mb; ++i) {
        le[i] = (le[i - 1] + l[i - 1]) << 1;
    }
    var co;
    if (r) {
        // u16 "map": index -> number of actual bits, symbol for code
        co = new u16(1 << mb);
        // bits to remove for reverser
        var rvb = 15 - mb;
        for (i = 0; i < s; ++i) {
            // ignore 0 lengths
            if (cd[i]) {
                // num encoding both symbol and bits read
                var sv = (i << 4) | cd[i];
                // free bits
                var r_1 = mb - cd[i];
                // start value
                var v = le[cd[i] - 1]++ << r_1;
                // m is end value
                for (var m = v | ((1 << r_1) - 1); v <= m; ++v) {
                    // every 16 bit value starting with the code yields the same result
                    co[rev[v] >> rvb] = sv;
                }
            }
        }
    }
    else {
        co = new u16(s);
        for (i = 0; i < s; ++i) {
            if (cd[i]) {
                co[i] = rev[le[cd[i] - 1]++] >> (15 - cd[i]);
            }
        }
    }
    return co;
});
// fixed length tree
var flt = new u8(288);
for (var i = 0; i < 144; ++i)
    flt[i] = 8;
for (var i = 144; i < 256; ++i)
    flt[i] = 9;
for (var i = 256; i < 280; ++i)
    flt[i] = 7;
for (var i = 280; i < 288; ++i)
    flt[i] = 8;
// fixed distance tree
var fdt = new u8(32);
for (var i = 0; i < 32; ++i)
    fdt[i] = 5;
// fixed length map
var flm = /*#__PURE__*/ hMap(flt, 9, 0), flrm = /*#__PURE__*/ hMap(flt, 9, 1);
// fixed distance map
var fdm = /*#__PURE__*/ hMap(fdt, 5, 0), fdrm = /*#__PURE__*/ hMap(fdt, 5, 1);
// find max of array
var max = function (a) {
    var m = a[0];
    for (var i = 1; i < a.length; ++i) {
        if (a[i] > m)
            m = a[i];
    }
    return m;
};
// read d, starting at bit p and mask with m
var bits = function (d, p, m) {
    var o = (p / 8) | 0;
    return ((d[o] | (d[o + 1] << 8)) >> (p & 7)) & m;
};
// read d, starting at bit p continuing for at least 16 bits
var bits16 = function (d, p) {
    var o = (p / 8) | 0;
    return ((d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) >> (p & 7));
};
// get end of byte
var shft = function (p) { return ((p + 7) / 8) | 0; };
// typed array slice - allows garbage collector to free original reference,
// while being more compatible than .slice
var slc = function (v, s, e) {
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    // can't use .constructor in case user-supplied
    return new u8(v.subarray(s, e));
};
/**
 * Codes for errors generated within this library
 */
var FlateErrorCode = {
    UnexpectedEOF: 0,
    InvalidBlockType: 1,
    InvalidLengthLiteral: 2,
    InvalidDistance: 3,
    StreamFinished: 4,
    NoStreamHandler: 5,
    InvalidHeader: 6,
    NoCallback: 7,
    InvalidUTF8: 8,
    ExtraFieldTooLong: 9,
    InvalidDate: 10,
    FilenameTooLong: 11,
    StreamFinishing: 12,
    InvalidZipData: 13,
    UnknownCompressionMethod: 14
};
// error codes
var ec = [
    'unexpected EOF',
    'invalid block type',
    'invalid length/literal',
    'invalid distance',
    'stream finished',
    'no stream handler',
    ,
    'no callback',
    'invalid UTF-8 data',
    'extra field too long',
    'date not in range 1980-2099',
    'filename too long',
    'stream finishing',
    'invalid zip data'
    // determined by unknown compression method
];
;
var err = function (ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
        Error.captureStackTrace(e, err);
    if (!nt)
        throw e;
    return e;
};
// expands raw DEFLATE data
var inflt = function (dat, st, buf, dict) {
    // source length       dict length
    var sl = dat.length, dl = dict ? dict.length : 0;
    if (!sl || st.f && !st.l)
        return buf || new u8(0);
    var noBuf = !buf;
    // have to estimate size
    var resize = noBuf || st.i != 2;
    // no state
    var noSt = st.i;
    // Assumes roughly 33% compression ratio average
    if (noBuf)
        buf = new u8(sl * 3);
    // ensure buffer can fit at least l elements
    var cbuf = function (l) {
        var bl = buf.length;
        // need to increase size to fit
        if (l > bl) {
            // Double or set to necessary, whichever is greater
            var nbuf = new u8(Math.max(bl * 2, l));
            nbuf.set(buf);
            buf = nbuf;
        }
    };
    //  last chunk         bitpos           bytes
    var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
    // total bits
    var tbts = sl * 8;
    do {
        if (!lm) {
            // BFINAL - this is only 1 when last chunk is next
            final = bits(dat, pos, 1);
            // type: 0 = no compression, 1 = fixed huffman, 2 = dynamic huffman
            var type = bits(dat, pos + 1, 3);
            pos += 3;
            if (!type) {
                // go to end of byte boundary
                var s = shft(pos) + 4, l = dat[s - 4] | (dat[s - 3] << 8), t = s + l;
                if (t > sl) {
                    if (noSt)
                        err(0);
                    break;
                }
                // ensure size
                if (resize)
                    cbuf(bt + l);
                // Copy over uncompressed data
                buf.set(dat.subarray(s, t), bt);
                // Get new bitpos, update byte count
                st.b = bt += l, st.p = pos = t * 8, st.f = final;
                continue;
            }
            else if (type == 1)
                lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
            else if (type == 2) {
                //  literal                            lengths
                var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
                var tl = hLit + bits(dat, pos + 5, 31) + 1;
                pos += 14;
                // length+distance tree
                var ldt = new u8(tl);
                // code length tree
                var clt = new u8(19);
                for (var i = 0; i < hcLen; ++i) {
                    // use index map to get real code
                    clt[clim[i]] = bits(dat, pos + i * 3, 7);
                }
                pos += hcLen * 3;
                // code lengths bits
                var clb = max(clt), clbmsk = (1 << clb) - 1;
                // code lengths map
                var clm = hMap(clt, clb, 1);
                for (var i = 0; i < tl;) {
                    var r = clm[bits(dat, pos, clbmsk)];
                    // bits read
                    pos += r & 15;
                    // symbol
                    var s = r >> 4;
                    // code length to copy
                    if (s < 16) {
                        ldt[i++] = s;
                    }
                    else {
                        //  copy   count
                        var c = 0, n = 0;
                        if (s == 16)
                            n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
                        else if (s == 17)
                            n = 3 + bits(dat, pos, 7), pos += 3;
                        else if (s == 18)
                            n = 11 + bits(dat, pos, 127), pos += 7;
                        while (n--)
                            ldt[i++] = c;
                    }
                }
                //    length tree                 distance tree
                var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
                // max length bits
                lbt = max(lt);
                // max dist bits
                dbt = max(dt);
                lm = hMap(lt, lbt, 1);
                dm = hMap(dt, dbt, 1);
            }
            else
                err(1);
            if (pos > tbts) {
                if (noSt)
                    err(0);
                break;
            }
        }
        // Make sure the buffer can hold this + the largest possible addition
        // Maximum chunk size (practically, theoretically infinite) is 2^17
        if (resize)
            cbuf(bt + 131072);
        var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
        var lpos = pos;
        for (;; lpos = pos) {
            // bits read, code
            var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
            pos += c & 15;
            if (pos > tbts) {
                if (noSt)
                    err(0);
                break;
            }
            if (!c)
                err(2);
            if (sym < 256)
                buf[bt++] = sym;
            else if (sym == 256) {
                lpos = pos, lm = null;
                break;
            }
            else {
                var add = sym - 254;
                // no extra bits needed if less
                if (sym > 264) {
                    // index
                    var i = sym - 257, b = fleb[i];
                    add = bits(dat, pos, (1 << b) - 1) + fl[i];
                    pos += b;
                }
                // dist
                var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
                if (!d)
                    err(3);
                pos += d & 15;
                var dt = fd[dsym];
                if (dsym > 3) {
                    var b = fdeb[dsym];
                    dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
                }
                if (pos > tbts) {
                    if (noSt)
                        err(0);
                    break;
                }
                if (resize)
                    cbuf(bt + 131072);
                var end = bt + add;
                if (bt < dt) {
                    var shift = dl - dt, dend = Math.min(dt, end);
                    if (shift + bt < 0)
                        err(3);
                    for (; bt < dend; ++bt)
                        buf[bt] = dict[shift + bt];
                }
                for (; bt < end; ++bt)
                    buf[bt] = buf[bt - dt];
            }
        }
        st.l = lm, st.p = lpos, st.b = bt, st.f = final;
        if (lm)
            final = 1, st.m = lbt, st.d = dm, st.n = dbt;
    } while (!final);
    // don't reallocate for streams or user buffers
    return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
// starting at p, write the minimum number of bits that can hold v to d
var wbits = function (d, p, v) {
    v <<= p & 7;
    var o = (p / 8) | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
};
// starting at p, write the minimum number of bits (>8) that can hold v to d
var wbits16 = function (d, p, v) {
    v <<= p & 7;
    var o = (p / 8) | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
    d[o + 2] |= v >> 16;
};
// creates code lengths from a frequency table
var hTree = function (d, mb) {
    // Need extra info to make a tree
    var t = [];
    for (var i = 0; i < d.length; ++i) {
        if (d[i])
            t.push({ s: i, f: d[i] });
    }
    var s = t.length;
    var t2 = t.slice();
    if (!s)
        return { t: et, l: 0 };
    if (s == 1) {
        var v = new u8(t[0].s + 1);
        v[t[0].s] = 1;
        return { t: v, l: 1 };
    }
    t.sort(function (a, b) { return a.f - b.f; });
    // after i2 reaches last ind, will be stopped
    // freq must be greater than largest possible number of symbols
    t.push({ s: -1, f: 25001 });
    var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
    t[0] = { s: -1, f: l.f + r.f, l: l, r: r };
    // efficient algorithm from UZIP.js
    // i0 is lookbehind, i2 is lookahead - after processing two low-freq
    // symbols that combined have high freq, will start processing i2 (high-freq,
    // non-composite) symbols instead
    // see https://reddit.com/r/photopea/comments/ikekht/uzipjs_questions/
    while (i1 != s - 1) {
        l = t[t[i0].f < t[i2].f ? i0++ : i2++];
        r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
        t[i1++] = { s: -1, f: l.f + r.f, l: l, r: r };
    }
    var maxSym = t2[0].s;
    for (var i = 1; i < s; ++i) {
        if (t2[i].s > maxSym)
            maxSym = t2[i].s;
    }
    // code lengths
    var tr = new u16(maxSym + 1);
    // max bits in tree
    var mbt = ln(t[i1 - 1], tr, 0);
    if (mbt > mb) {
        // more algorithms from UZIP.js
        // TODO: find out how this code works (debt)
        //  ind    debt
        var i = 0, dt = 0;
        //    left            cost
        var lft = mbt - mb, cst = 1 << lft;
        t2.sort(function (a, b) { return tr[b.s] - tr[a.s] || a.f - b.f; });
        for (; i < s; ++i) {
            var i2_1 = t2[i].s;
            if (tr[i2_1] > mb) {
                dt += cst - (1 << (mbt - tr[i2_1]));
                tr[i2_1] = mb;
            }
            else
                break;
        }
        dt >>= lft;
        while (dt > 0) {
            var i2_2 = t2[i].s;
            if (tr[i2_2] < mb)
                dt -= 1 << (mb - tr[i2_2]++ - 1);
            else
                ++i;
        }
        for (; i >= 0 && dt; --i) {
            var i2_3 = t2[i].s;
            if (tr[i2_3] == mb) {
                --tr[i2_3];
                ++dt;
            }
        }
        mbt = mb;
    }
    return { t: new u8(tr), l: mbt };
};
// get the max length and assign length codes
var ln = function (n, l, d) {
    return n.s == -1
        ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1))
        : (l[n.s] = d);
};
// length codes generation
var lc = function (c) {
    var s = c.length;
    // Note that the semicolon was intentional
    while (s && !c[--s])
        ;
    var cl = new u16(++s);
    //  ind      num         streak
    var cli = 0, cln = c[0], cls = 1;
    var w = function (v) { cl[cli++] = v; };
    for (var i = 1; i <= s; ++i) {
        if (c[i] == cln && i != s)
            ++cls;
        else {
            if (!cln && cls > 2) {
                for (; cls > 138; cls -= 138)
                    w(32754);
                if (cls > 2) {
                    w(cls > 10 ? ((cls - 11) << 5) | 28690 : ((cls - 3) << 5) | 12305);
                    cls = 0;
                }
            }
            else if (cls > 3) {
                w(cln), --cls;
                for (; cls > 6; cls -= 6)
                    w(8304);
                if (cls > 2)
                    w(((cls - 3) << 5) | 8208), cls = 0;
            }
            while (cls--)
                w(cln);
            cls = 1;
            cln = c[i];
        }
    }
    return { c: cl.subarray(0, cli), n: s };
};
// calculate the length of output from tree, code lengths
var clen = function (cf, cl) {
    var l = 0;
    for (var i = 0; i < cl.length; ++i)
        l += cf[i] * cl[i];
    return l;
};
// writes a fixed block
// returns the new bit pos
var wfblk = function (out, pos, dat) {
    // no need to write 00 as type: TypedArray defaults to 0
    var s = dat.length;
    var o = shft(pos + 2);
    out[o] = s & 255;
    out[o + 1] = s >> 8;
    out[o + 2] = out[o] ^ 255;
    out[o + 3] = out[o + 1] ^ 255;
    for (var i = 0; i < s; ++i)
        out[o + i + 4] = dat[i];
    return (o + 4 + s) * 8;
};
// writes a block
var wblk = function (dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
    wbits(out, p++, final);
    ++lf[256];
    var _a = hTree(lf, 15), dlt = _a.t, mlb = _a.l;
    var _b = hTree(df, 15), ddt = _b.t, mdb = _b.l;
    var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
    var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
    var lcfreq = new u16(19);
    for (var i = 0; i < lclt.length; ++i)
        ++lcfreq[lclt[i] & 31];
    for (var i = 0; i < lcdt.length; ++i)
        ++lcfreq[lcdt[i] & 31];
    var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
    var nlcc = 19;
    for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
        ;
    var flen = (bl + 5) << 3;
    var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
    var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
    if (bs >= 0 && flen <= ftlen && flen <= dtlen)
        return wfblk(out, p, dat.subarray(bs, bs + bl));
    var lm, ll, dm, dl;
    wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
    if (dtlen < ftlen) {
        lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
        var llm = hMap(lct, mlcb, 0);
        wbits(out, p, nlc - 257);
        wbits(out, p + 5, ndc - 1);
        wbits(out, p + 10, nlcc - 4);
        p += 14;
        for (var i = 0; i < nlcc; ++i)
            wbits(out, p + 3 * i, lct[clim[i]]);
        p += 3 * nlcc;
        var lcts = [lclt, lcdt];
        for (var it = 0; it < 2; ++it) {
            var clct = lcts[it];
            for (var i = 0; i < clct.length; ++i) {
                var len = clct[i] & 31;
                wbits(out, p, llm[len]), p += lct[len];
                if (len > 15)
                    wbits(out, p, (clct[i] >> 5) & 127), p += clct[i] >> 12;
            }
        }
    }
    else {
        lm = flm, ll = flt, dm = fdm, dl = fdt;
    }
    for (var i = 0; i < li; ++i) {
        var sym = syms[i];
        if (sym > 255) {
            var len = (sym >> 18) & 31;
            wbits16(out, p, lm[len + 257]), p += ll[len + 257];
            if (len > 7)
                wbits(out, p, (sym >> 23) & 31), p += fleb[len];
            var dst = sym & 31;
            wbits16(out, p, dm[dst]), p += dl[dst];
            if (dst > 3)
                wbits16(out, p, (sym >> 5) & 8191), p += fdeb[dst];
        }
        else {
            wbits16(out, p, lm[sym]), p += ll[sym];
        }
    }
    wbits16(out, p, lm[256]);
    return p + ll[256];
};
// deflate options (nice << 13) | chain
var deo = /*#__PURE__*/ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
// empty
var et = /*#__PURE__*/ new u8(0);
// compresses data into a raw DEFLATE buffer
var dflt = function (dat, lvl, plvl, pre, post, st) {
    var s = st.z || dat.length;
    var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
    // writing to this writes to the output buffer
    var w = o.subarray(pre, o.length - post);
    var lst = st.l;
    var pos = (st.r || 0) & 7;
    if (lvl) {
        if (pos)
            w[0] = st.r >> 3;
        var opt = deo[lvl - 1];
        var n = opt >> 13, c = opt & 8191;
        var msk_1 = (1 << plvl) - 1;
        //    prev 2-byte val map    curr 2-byte val map
        var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
        var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
        var hsh = function (i) { return (dat[i] ^ (dat[i + 1] << bs1_1) ^ (dat[i + 2] << bs2_1)) & msk_1; };
        // 24576 is an arbitrary number of maximum symbols per block
        // 424 buffer for last block
        var syms = new i32(25000);
        // length/literal freq   distance freq
        var lf = new u16(288), df = new u16(32);
        //  l/lcnt  exbits  index          l/lind  waitdx          blkpos
        var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
        for (; i + 2 < s; ++i) {
            // hash value
            var hv = hsh(i);
            // index mod 32768    previous index mod
            var imod = i & 32767, pimod = head[hv];
            prev[imod] = pimod;
            head[hv] = imod;
            // We always should modify head and prev, but only add symbols if
            // this data is not yet processed ("wait" for wait index)
            if (wi <= i) {
                // bytes remaining
                var rem = s - i;
                if ((lc_1 > 7000 || li > 24576) && (rem > 423 || !lst)) {
                    pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
                    li = lc_1 = eb = 0, bs = i;
                    for (var j = 0; j < 286; ++j)
                        lf[j] = 0;
                    for (var j = 0; j < 30; ++j)
                        df[j] = 0;
                }
                //  len    dist   chain
                var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
                if (rem > 2 && hv == hsh(i - dif)) {
                    var maxn = Math.min(n, rem) - 1;
                    var maxd = Math.min(32767, i);
                    // max possible length
                    // not capped at dif because decompressors implement "rolling" index population
                    var ml = Math.min(258, rem);
                    while (dif <= maxd && --ch_1 && imod != pimod) {
                        if (dat[i + l] == dat[i + l - dif]) {
                            var nl = 0;
                            for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                                ;
                            if (nl > l) {
                                l = nl, d = dif;
                                // break out early when we reach "nice" (we are satisfied enough)
                                if (nl > maxn)
                                    break;
                                // now, find the rarest 2-byte sequence within this
                                // length of literals and search for that instead.
                                // Much faster than just using the start
                                var mmd = Math.min(dif, nl - 2);
                                var md = 0;
                                for (var j = 0; j < mmd; ++j) {
                                    var ti = i - dif + j & 32767;
                                    var pti = prev[ti];
                                    var cd = ti - pti & 32767;
                                    if (cd > md)
                                        md = cd, pimod = ti;
                                }
                            }
                        }
                        // check the previous match
                        imod = pimod, pimod = prev[imod];
                        dif += imod - pimod & 32767;
                    }
                }
                // d will be nonzero only when a match was found
                if (d) {
                    // store both dist and len data in one int32
                    // Make sure this is recognized as a len/dist with 28th bit (2^28)
                    syms[li++] = 268435456 | (revfl[l] << 18) | revfd[d];
                    var lin = revfl[l] & 31, din = revfd[d] & 31;
                    eb += fleb[lin] + fdeb[din];
                    ++lf[257 + lin];
                    ++df[din];
                    wi = i + l;
                    ++lc_1;
                }
                else {
                    syms[li++] = dat[i];
                    ++lf[dat[i]];
                }
            }
        }
        for (i = Math.max(i, wi); i < s; ++i) {
            syms[li++] = dat[i];
            ++lf[dat[i]];
        }
        pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
        if (!lst) {
            st.r = (pos & 7) | w[(pos / 8) | 0] << 3;
            // shft(pos) now 1 less if pos & 7 != 0
            pos -= 7;
            st.h = head, st.p = prev, st.i = i, st.w = wi;
        }
    }
    else {
        for (var i = st.w || 0; i < s + lst; i += 65535) {
            // end
            var e = i + 65535;
            if (e >= s) {
                // write final block
                w[(pos / 8) | 0] = lst;
                e = s;
            }
            pos = wfblk(w, pos + 1, dat.subarray(i, e));
        }
        st.i = s;
    }
    return slc(o, 0, pre + shft(pos) + post);
};
// CRC32 table
var crct = /*#__PURE__*/ (function () {
    var t = new Int32Array(256);
    for (var i = 0; i < 256; ++i) {
        var c = i, k = 9;
        while (--k)
            c = ((c & 1) && -306674912) ^ (c >>> 1);
        t[i] = c;
    }
    return t;
})();
// CRC32
var crc = function () {
    var c = -1;
    return {
        p: function (d) {
            // closures have awful performance
            var cr = c;
            for (var i = 0; i < d.length; ++i)
                cr = crct[(cr & 255) ^ d[i]] ^ (cr >>> 8);
            c = cr;
        },
        d: function () { return ~c; }
    };
};
// Adler32
var adler = function () {
    var a = 1, b = 0;
    return {
        p: function (d) {
            // closures have awful performance
            var n = a, m = b;
            var l = d.length | 0;
            for (var i = 0; i != l;) {
                var e = Math.min(i + 2655, l);
                for (; i < e; ++i)
                    m += n += d[i];
                n = (n & 65535) + 15 * (n >> 16), m = (m & 65535) + 15 * (m >> 16);
            }
            a = n, b = m;
        },
        d: function () {
            a %= 65521, b %= 65521;
            return (a & 255) << 24 | (a & 0xFF00) << 8 | (b & 255) << 8 | (b >> 8);
        }
    };
};
;
// deflate with opts
var dopt = function (dat, opt, pre, post, st) {
    if (!st) {
        st = { l: 1 };
        if (opt.dictionary) {
            var dict = opt.dictionary.subarray(-32768);
            var newDat = new u8(dict.length + dat.length);
            newDat.set(dict);
            newDat.set(dat, dict.length);
            dat = newDat;
            st.w = dict.length;
        }
    }
    return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? (st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20) : (12 + opt.mem), pre, post, st);
};
// Walmart object spread
var mrg = function (a, b) {
    var o = {};
    for (var k in a)
        o[k] = a[k];
    for (var k in b)
        o[k] = b[k];
    return o;
};
// worker clone
// This is possibly the craziest part of the entire codebase, despite how simple it may seem.
// The only parameter to this function is a closure that returns an array of variables outside of the function scope.
// We're going to try to figure out the variable names used in the closure as strings because that is crucial for workerization.
// We will return an object mapping of true variable name to value (basically, the current scope as a JS object).
// The reason we can't just use the original variable names is minifiers mangling the toplevel scope.
// This took me three weeks to figure out how to do.
var wcln = function (fn, fnStr, td) {
    var dt = fn();
    var st = fn.toString();
    var ks = st.slice(st.indexOf('[') + 1, st.lastIndexOf(']')).replace(/\s+/g, '').split(',');
    for (var i = 0; i < dt.length; ++i) {
        var v = dt[i], k = ks[i];
        if (typeof v == 'function') {
            fnStr += ';' + k + '=';
            var st_1 = v.toString();
            if (v.prototype) {
                // for global objects
                if (st_1.indexOf('[native code]') != -1) {
                    var spInd = st_1.indexOf(' ', 8) + 1;
                    fnStr += st_1.slice(spInd, st_1.indexOf('(', spInd));
                }
                else {
                    fnStr += st_1;
                    for (var t in v.prototype)
                        fnStr += ';' + k + '.prototype.' + t + '=' + v.prototype[t].toString();
                }
            }
            else
                fnStr += st_1;
        }
        else
            td[k] = v;
    }
    return fnStr;
};
var ch = [];
// clone bufs
var cbfs = function (v) {
    var tl = [];
    for (var k in v) {
        if (v[k].buffer) {
            tl.push((v[k] = new v[k].constructor(v[k])).buffer);
        }
    }
    return tl;
};
// use a worker to execute code
var wrkr = function (fns, init, id, cb) {
    if (!ch[id]) {
        var fnStr = '', td_1 = {}, m = fns.length - 1;
        for (var i = 0; i < m; ++i)
            fnStr = wcln(fns[i], fnStr, td_1);
        ch[id] = { c: wcln(fns[m], fnStr, td_1), e: td_1 };
    }
    var td = mrg({}, ch[id].e);
    return wk(ch[id].c + ';onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage=' + init.toString() + '}', id, td, cbfs(td), cb);
};
// base async inflate fn
var bInflt = function () { return [u8, u16, i32, fleb, fdeb, clim, fl, fd, flrm, fdrm, rev, ec, hMap, max, bits, bits16, shft, slc, err, inflt, inflateSync, pbf, gopt]; };
var bDflt = function () { return [u8, u16, i32, fleb, fdeb, clim, revfl, revfd, flm, flt, fdm, fdt, rev, deo, et, hMap, wbits, wbits16, hTree, ln, lc, clen, wfblk, wblk, shft, slc, dflt, dopt, deflateSync, pbf]; };
// gzip extra
var gze = function () { return [gzh, gzhl, wbytes, crc, crct]; };
// gunzip extra
var guze = function () { return [gzs, gzl]; };
// zlib extra
var zle = function () { return [zlh, wbytes, adler]; };
// unzlib extra
var zule = function () { return [zls]; };
// post buf
var pbf = function (msg) { return postMessage(msg, [msg.buffer]); };
// get opts
var gopt = function (o) { return o && {
    out: o.size && new u8(o.size),
    dictionary: o.dictionary
}; };
// async helper
var cbify = function (dat, opts, fns, init, id, cb) {
    var w = wrkr(fns, init, id, function (err, dat) {
        w.terminate();
        cb(err, dat);
    });
    w.postMessage([dat, opts], opts.consume ? [dat.buffer] : []);
    return function () { w.terminate(); };
};
// auto stream
var astrm = function (strm) {
    strm.ondata = function (dat, final) { return postMessage([dat, final], [dat.buffer]); };
    return function (ev) {
        if (ev.data.length) {
            strm.push(ev.data[0], ev.data[1]);
            postMessage([ev.data[0].length]);
        }
        else
            strm.flush();
    };
};
// async stream attach
var astrmify = function (fns, strm, opts, init, id, flush, ext) {
    var t;
    var w = wrkr(fns, init, id, function (err, dat) {
        if (err)
            w.terminate(), strm.ondata.call(strm, err);
        else if (!Array.isArray(dat))
            ext(dat);
        else if (dat.length == 1) {
            strm.queuedSize -= dat[0];
            if (strm.ondrain)
                strm.ondrain(dat[0]);
        }
        else {
            if (dat[1])
                w.terminate();
            strm.ondata.call(strm, err, dat[0], dat[1]);
        }
    });
    w.postMessage(opts);
    strm.queuedSize = 0;
    strm.push = function (d, f) {
        if (!strm.ondata)
            err(5);
        if (t)
            strm.ondata(err(4, 0, 1), null, !!f);
        strm.queuedSize += d.length;
        w.postMessage([d, t = f], [d.buffer]);
    };
    strm.terminate = function () { w.terminate(); };
    if (flush) {
        strm.flush = function () { w.postMessage([]); };
    }
};
// read 2 bytes
var b2 = function (d, b) { return d[b] | (d[b + 1] << 8); };
// read 4 bytes
var b4 = function (d, b) { return (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0; };
var b8 = function (d, b) { return b4(d, b) + (b4(d, b + 4) * 4294967296); };
// write bytes
var wbytes = function (d, b, v) {
    for (; v; ++b)
        d[b] = v, v >>>= 8;
};
// gzip header
var gzh = function (c, o) {
    var fn = o.filename;
    c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3; // assume Unix
    if (o.mtime != 0)
        wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1000));
    if (fn) {
        c[3] = 8;
        for (var i = 0; i <= fn.length; ++i)
            c[i + 10] = fn.charCodeAt(i);
    }
};
// gzip footer: -8 to -4 = CRC, -4 to -0 is length
// gzip start
var gzs = function (d) {
    if (d[0] != 31 || d[1] != 139 || d[2] != 8)
        err(6, 'invalid gzip data');
    var flg = d[3];
    var st = 10;
    if (flg & 4)
        st += (d[10] | d[11] << 8) + 2;
    for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1); zs > 0; zs -= !d[st++])
        ;
    return st + (flg & 2);
};
// gzip length
var gzl = function (d) {
    var l = d.length;
    return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
};
// gzip header length
var gzhl = function (o) { return 10 + (o.filename ? o.filename.length + 1 : 0); };
// zlib header
var zlh = function (c, o) {
    var lv = o.level, fl = lv == 0 ? 0 : lv < 6 ? 1 : lv == 9 ? 3 : 2;
    c[0] = 120, c[1] = (fl << 6) | (o.dictionary && 32);
    c[1] |= 31 - ((c[0] << 8) | c[1]) % 31;
    if (o.dictionary) {
        var h = adler();
        h.p(o.dictionary);
        wbytes(c, 2, h.d());
    }
};
// zlib start
var zls = function (d, dict) {
    if ((d[0] & 15) != 8 || (d[0] >> 4) > 7 || ((d[0] << 8 | d[1]) % 31))
        err(6, 'invalid zlib data');
    if ((d[1] >> 5 & 1) == +!dict)
        err(6, 'invalid zlib data: ' + (d[1] & 32 ? 'need' : 'unexpected') + ' dictionary');
    return (d[1] >> 3 & 4) + 2;
};
function StrmOpt(opts, cb) {
    if (typeof opts == 'function')
        cb = opts, opts = {};
    this.ondata = cb;
    return opts;
}
/**
 * Streaming DEFLATE compression
 */
var Deflate = /*#__PURE__*/ (function () {
    function Deflate(opts, cb) {
        if (typeof opts == 'function')
            cb = opts, opts = {};
        this.ondata = cb;
        this.o = opts || {};
        this.s = { l: 0, i: 32768, w: 32768, z: 32768 };
        // Buffer length must always be 0 mod 32768 for index calculations to be correct when modifying head and prev
        // 98304 = 32768 (lookback) + 65536 (common chunk size)
        this.b = new u8(98304);
        if (this.o.dictionary) {
            var dict = this.o.dictionary.subarray(-32768);
            this.b.set(dict, 32768 - dict.length);
            this.s.i = 32768 - dict.length;
        }
    }
    Deflate.prototype.p = function (c, f) {
        this.ondata(dopt(c, this.o, 0, 0, this.s), f);
    };
    /**
     * Pushes a chunk to be deflated
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Deflate.prototype.push = function (chunk, final) {
        if (!this.ondata)
            err(5);
        if (this.s.l)
            err(4);
        var endLen = chunk.length + this.s.z;
        if (endLen > this.b.length) {
            if (endLen > 2 * this.b.length - 32768) {
                var newBuf = new u8(endLen & -32768);
                newBuf.set(this.b.subarray(0, this.s.z));
                this.b = newBuf;
            }
            var split = this.b.length - this.s.z;
            this.b.set(chunk.subarray(0, split), this.s.z);
            this.s.z = this.b.length;
            this.p(this.b, false);
            this.b.set(this.b.subarray(-32768));
            this.b.set(chunk.subarray(split), 32768);
            this.s.z = chunk.length - split + 32768;
            this.s.i = 32766, this.s.w = 32768;
        }
        else {
            this.b.set(chunk, this.s.z);
            this.s.z += chunk.length;
        }
        this.s.l = final & 1;
        if (this.s.z > this.s.w + 8191 || final) {
            this.p(this.b, final || false);
            this.s.w = this.s.i, this.s.i -= 2;
        }
    };
    /**
     * Flushes buffered uncompressed data. Useful to immediately retrieve the
     * deflated output for small inputs.
     */
    Deflate.prototype.flush = function () {
        if (!this.ondata)
            err(5);
        if (this.s.l)
            err(4);
        this.p(this.b, false);
        this.s.w = this.s.i, this.s.i -= 2;
    };
    return Deflate;
}());

/**
 * Asynchronous streaming DEFLATE compression
 */
var AsyncDeflate = /*#__PURE__*/ (function () {
    function AsyncDeflate(opts, cb) {
        astrmify([
            bDflt,
            function () { return [astrm, Deflate]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Deflate(ev.data);
            onmessage = astrm(strm);
        }, 6, 1);
    }
    return AsyncDeflate;
}());

function deflate(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bDflt,
    ], function (ev) { return pbf(deflateSync(ev.data[0], ev.data[1])); }, 0, cb);
}
/**
 * Compresses data with DEFLATE without any wrapper
 * @param data The data to compress
 * @param opts The compression options
 * @returns The deflated version of the data
 */
function deflateSync(data, opts) {
    return dopt(data, opts || {}, 0, 0);
}
/**
 * Streaming DEFLATE decompression
 */
var Inflate = /*#__PURE__*/ (function () {
    function Inflate(opts, cb) {
        // no StrmOpt here to avoid adding to workerizer
        if (typeof opts == 'function')
            cb = opts, opts = {};
        this.ondata = cb;
        var dict = opts && opts.dictionary && opts.dictionary.subarray(-32768);
        this.s = { i: 0, b: dict ? dict.length : 0 };
        this.o = new u8(32768);
        this.p = new u8(0);
        if (dict)
            this.o.set(dict);
    }
    Inflate.prototype.e = function (c) {
        if (!this.ondata)
            err(5);
        if (this.d)
            err(4);
        if (!this.p.length)
            this.p = c;
        else if (c.length) {
            var n = new u8(this.p.length + c.length);
            n.set(this.p), n.set(c, this.p.length), this.p = n;
        }
    };
    Inflate.prototype.c = function (final) {
        this.s.i = +(this.d = final || false);
        var bts = this.s.b;
        var dt = inflt(this.p, this.s, this.o);
        this.ondata(slc(dt, bts, this.s.b), this.d);
        this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
        this.p = slc(this.p, (this.s.p / 8) | 0), this.s.p &= 7;
    };
    /**
     * Pushes a chunk to be inflated
     * @param chunk The chunk to push
     * @param final Whether this is the final chunk
     */
    Inflate.prototype.push = function (chunk, final) {
        this.e(chunk), this.c(final);
    };
    return Inflate;
}());

/**
 * Asynchronous streaming DEFLATE decompression
 */
var AsyncInflate = /*#__PURE__*/ (function () {
    function AsyncInflate(opts, cb) {
        astrmify([
            bInflt,
            function () { return [astrm, Inflate]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Inflate(ev.data);
            onmessage = astrm(strm);
        }, 7, 0);
    }
    return AsyncInflate;
}());

function inflate(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bInflt
    ], function (ev) { return pbf(inflateSync(ev.data[0], gopt(ev.data[1]))); }, 1, cb);
}
/**
 * Expands DEFLATE data with no wrapper
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
function inflateSync(data, opts) {
    return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
// before you yell at me for not just using extends, my reason is that TS inheritance is hard to workerize.
/**
 * Streaming GZIP compression
 */
var Gzip = /*#__PURE__*/ (function () {
    function Gzip(opts, cb) {
        this.c = crc();
        this.l = 0;
        this.v = 1;
        Deflate.call(this, opts, cb);
    }
    /**
     * Pushes a chunk to be GZIPped
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Gzip.prototype.push = function (chunk, final) {
        this.c.p(chunk);
        this.l += chunk.length;
        Deflate.prototype.push.call(this, chunk, final);
    };
    Gzip.prototype.p = function (c, f) {
        var raw = dopt(c, this.o, this.v && gzhl(this.o), f && 8, this.s);
        if (this.v)
            gzh(raw, this.o), this.v = 0;
        if (f)
            wbytes(raw, raw.length - 8, this.c.d()), wbytes(raw, raw.length - 4, this.l);
        this.ondata(raw, f);
    };
    /**
     * Flushes buffered uncompressed data. Useful to immediately retrieve the
     * GZIPped output for small inputs.
     */
    Gzip.prototype.flush = function () {
        Deflate.prototype.flush.call(this);
    };
    return Gzip;
}());

/**
 * Asynchronous streaming GZIP compression
 */
var AsyncGzip = /*#__PURE__*/ (function () {
    function AsyncGzip(opts, cb) {
        astrmify([
            bDflt,
            gze,
            function () { return [astrm, Deflate, Gzip]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Gzip(ev.data);
            onmessage = astrm(strm);
        }, 8, 1);
    }
    return AsyncGzip;
}());

function gzip(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bDflt,
        gze,
        function () { return [gzipSync]; }
    ], function (ev) { return pbf(gzipSync(ev.data[0], ev.data[1])); }, 2, cb);
}
/**
 * Compresses data with GZIP
 * @param data The data to compress
 * @param opts The compression options
 * @returns The gzipped version of the data
 */
function gzipSync(data, opts) {
    if (!opts)
        opts = {};
    var c = crc(), l = data.length;
    c.p(data);
    var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
    return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
}
/**
 * Streaming single or multi-member GZIP decompression
 */
var Gunzip = /*#__PURE__*/ (function () {
    function Gunzip(opts, cb) {
        this.v = 1;
        this.r = 0;
        Inflate.call(this, opts, cb);
    }
    /**
     * Pushes a chunk to be GUNZIPped
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Gunzip.prototype.push = function (chunk, final) {
        Inflate.prototype.e.call(this, chunk);
        this.r += chunk.length;
        if (this.v) {
            var p = this.p.subarray(this.v - 1);
            var s = p.length > 3 ? gzs(p) : 4;
            if (s > p.length) {
                if (!final)
                    return;
            }
            else if (this.v > 1 && this.onmember) {
                this.onmember(this.r - p.length);
            }
            this.p = p.subarray(s), this.v = 0;
        }
        // necessary to prevent TS from using the closure value
        // This allows for workerization to function correctly
        Inflate.prototype.c.call(this, final);
        // process concatenated GZIP
        if (this.s.f && !this.s.l && !final) {
            this.v = shft(this.s.p) + 9;
            this.s = { i: 0 };
            this.o = new u8(0);
            this.push(new u8(0), final);
        }
    };
    return Gunzip;
}());

/**
 * Asynchronous streaming single or multi-member GZIP decompression
 */
var AsyncGunzip = /*#__PURE__*/ (function () {
    function AsyncGunzip(opts, cb) {
        var _this = this;
        astrmify([
            bInflt,
            guze,
            function () { return [astrm, Inflate, Gunzip]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Gunzip(ev.data);
            strm.onmember = function (offset) { return postMessage(offset); };
            onmessage = astrm(strm);
        }, 9, 0, function (offset) { return _this.onmember && _this.onmember(offset); });
    }
    return AsyncGunzip;
}());

function gunzip(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bInflt,
        guze,
        function () { return [gunzipSync]; }
    ], function (ev) { return pbf(gunzipSync(ev.data[0], ev.data[1])); }, 3, cb);
}
/**
 * Expands GZIP data
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
function gunzipSync(data, opts) {
    var st = gzs(data);
    if (st + 8 > data.length)
        err(6, 'invalid gzip data');
    return inflt(data.subarray(st, -8), { i: 2 }, opts && opts.out || new u8(gzl(data)), opts && opts.dictionary);
}
/**
 * Streaming Zlib compression
 */
var Zlib = /*#__PURE__*/ (function () {
    function Zlib(opts, cb) {
        this.c = adler();
        this.v = 1;
        Deflate.call(this, opts, cb);
    }
    /**
     * Pushes a chunk to be zlibbed
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Zlib.prototype.push = function (chunk, final) {
        this.c.p(chunk);
        Deflate.prototype.push.call(this, chunk, final);
    };
    Zlib.prototype.p = function (c, f) {
        var raw = dopt(c, this.o, this.v && (this.o.dictionary ? 6 : 2), f && 4, this.s);
        if (this.v)
            zlh(raw, this.o), this.v = 0;
        if (f)
            wbytes(raw, raw.length - 4, this.c.d());
        this.ondata(raw, f);
    };
    /**
     * Flushes buffered uncompressed data. Useful to immediately retrieve the
     * zlibbed output for small inputs.
     */
    Zlib.prototype.flush = function () {
        Deflate.prototype.flush.call(this);
    };
    return Zlib;
}());

/**
 * Asynchronous streaming Zlib compression
 */
var AsyncZlib = /*#__PURE__*/ (function () {
    function AsyncZlib(opts, cb) {
        astrmify([
            bDflt,
            zle,
            function () { return [astrm, Deflate, Zlib]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Zlib(ev.data);
            onmessage = astrm(strm);
        }, 10, 1);
    }
    return AsyncZlib;
}());

function zlib(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bDflt,
        zle,
        function () { return [zlibSync]; }
    ], function (ev) { return pbf(zlibSync(ev.data[0], ev.data[1])); }, 4, cb);
}
/**
 * Compress data with Zlib
 * @param data The data to compress
 * @param opts The compression options
 * @returns The zlib-compressed version of the data
 */
function zlibSync(data, opts) {
    if (!opts)
        opts = {};
    var a = adler();
    a.p(data);
    var d = dopt(data, opts, opts.dictionary ? 6 : 2, 4);
    return zlh(d, opts), wbytes(d, d.length - 4, a.d()), d;
}
/**
 * Streaming Zlib decompression
 */
var Unzlib = /*#__PURE__*/ (function () {
    function Unzlib(opts, cb) {
        Inflate.call(this, opts, cb);
        this.v = opts && opts.dictionary ? 2 : 1;
    }
    /**
     * Pushes a chunk to be unzlibbed
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Unzlib.prototype.push = function (chunk, final) {
        Inflate.prototype.e.call(this, chunk);
        if (this.v) {
            if (this.p.length < 6 && !final)
                return;
            this.p = this.p.subarray(zls(this.p, this.v - 1)), this.v = 0;
        }
        if (final) {
            if (this.p.length < 4)
                err(6, 'invalid zlib data');
            this.p = this.p.subarray(0, -4);
        }
        // necessary to prevent TS from using the closure value
        // This allows for workerization to function correctly
        Inflate.prototype.c.call(this, final);
    };
    return Unzlib;
}());

/**
 * Asynchronous streaming Zlib decompression
 */
var AsyncUnzlib = /*#__PURE__*/ (function () {
    function AsyncUnzlib(opts, cb) {
        astrmify([
            bInflt,
            zule,
            function () { return [astrm, Inflate, Unzlib]; }
        ], this, StrmOpt.call(this, opts, cb), function (ev) {
            var strm = new Unzlib(ev.data);
            onmessage = astrm(strm);
        }, 11, 0);
    }
    return AsyncUnzlib;
}());

function unzlib(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return cbify(data, opts, [
        bInflt,
        zule,
        function () { return [unzlibSync]; }
    ], function (ev) { return pbf(unzlibSync(ev.data[0], gopt(ev.data[1]))); }, 5, cb);
}
/**
 * Expands Zlib data
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
function unzlibSync(data, opts) {
    return inflt(data.subarray(zls(data, opts && opts.dictionary), -4), { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
// Default algorithm for compression (used because having a known output size allows faster decompression)


/**
 * Streaming GZIP, Zlib, or raw DEFLATE decompression
 */
var Decompress = /*#__PURE__*/ (function () {
    function Decompress(opts, cb) {
        this.o = StrmOpt.call(this, opts, cb) || {};
        this.G = Gunzip;
        this.I = Inflate;
        this.Z = Unzlib;
    }
    // init substream
    // overriden by AsyncDecompress
    Decompress.prototype.i = function () {
        var _this = this;
        this.s.ondata = function (dat, final) {
            _this.ondata(dat, final);
        };
    };
    /**
     * Pushes a chunk to be decompressed
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Decompress.prototype.push = function (chunk, final) {
        if (!this.ondata)
            err(5);
        if (!this.s) {
            if (this.p && this.p.length) {
                var n = new u8(this.p.length + chunk.length);
                n.set(this.p), n.set(chunk, this.p.length);
            }
            else
                this.p = chunk;
            if (this.p.length > 2) {
                this.s = (this.p[0] == 31 && this.p[1] == 139 && this.p[2] == 8)
                    ? new this.G(this.o)
                    : ((this.p[0] & 15) != 8 || (this.p[0] >> 4) > 7 || ((this.p[0] << 8 | this.p[1]) % 31))
                        ? new this.I(this.o)
                        : new this.Z(this.o);
                this.i();
                this.s.push(this.p, final);
                this.p = null;
            }
        }
        else
            this.s.push(chunk, final);
    };
    return Decompress;
}());

/**
 * Asynchronous streaming GZIP, Zlib, or raw DEFLATE decompression
 */
var AsyncDecompress = /*#__PURE__*/ (function () {
    function AsyncDecompress(opts, cb) {
        Decompress.call(this, opts, cb);
        this.queuedSize = 0;
        this.G = AsyncGunzip;
        this.I = AsyncInflate;
        this.Z = AsyncUnzlib;
    }
    AsyncDecompress.prototype.i = function () {
        var _this = this;
        this.s.ondata = function (err, dat, final) {
            _this.ondata(err, dat, final);
        };
        this.s.ondrain = function (size) {
            _this.queuedSize -= size;
            if (_this.ondrain)
                _this.ondrain(size);
        };
    };
    /**
     * Pushes a chunk to be decompressed
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    AsyncDecompress.prototype.push = function (chunk, final) {
        this.queuedSize += chunk.length;
        Decompress.prototype.push.call(this, chunk, final);
    };
    return AsyncDecompress;
}());

function decompress(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    return (data[0] == 31 && data[1] == 139 && data[2] == 8)
        ? gunzip(data, opts, cb)
        : ((data[0] & 15) != 8 || (data[0] >> 4) > 7 || ((data[0] << 8 | data[1]) % 31))
            ? inflate(data, opts, cb)
            : unzlib(data, opts, cb);
}
/**
 * Expands compressed GZIP, Zlib, or raw DEFLATE data, automatically detecting the format
 * @param data The data to decompress
 * @param opts The decompression options
 * @returns The decompressed version of the data
 */
function decompressSync(data, opts) {
    return (data[0] == 31 && data[1] == 139 && data[2] == 8)
        ? gunzipSync(data, opts)
        : ((data[0] & 15) != 8 || (data[0] >> 4) > 7 || ((data[0] << 8 | data[1]) % 31))
            ? inflateSync(data, opts)
            : unzlibSync(data, opts);
}
// flatten a directory structure
var fltn = function (d, p, t, o) {
    for (var k in d) {
        var val = d[k], n = p + k, op = o;
        if (Array.isArray(val))
            op = mrg(o, val[1]), val = val[0];
        if (val instanceof u8)
            t[n] = [val, op];
        else {
            t[n += '/'] = [new u8(0), op];
            fltn(val, n, t, o);
        }
    }
};
// text encoder
var te = typeof TextEncoder != 'undefined' && /*#__PURE__*/ new TextEncoder();
// text decoder
var td = typeof TextDecoder != 'undefined' && /*#__PURE__*/ new TextDecoder();
// text decoder stream
var tds = 0;
try {
    td.decode(et, { stream: true });
    tds = 1;
}
catch (e) { }
// decode UTF8
var dutf8 = function (d) {
    for (var r = '', i = 0;;) {
        var c = d[i++];
        var eb = (c > 127) + (c > 223) + (c > 239);
        if (i + eb > d.length)
            return { s: r, r: slc(d, i - 1) };
        if (!eb)
            r += String.fromCharCode(c);
        else if (eb == 3) {
            c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | (d[i++] & 63)) - 65536,
                r += String.fromCharCode(55296 | (c >> 10), 56320 | (c & 1023));
        }
        else if (eb & 1)
            r += String.fromCharCode((c & 31) << 6 | (d[i++] & 63));
        else
            r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | (d[i++] & 63));
    }
};
/**
 * Streaming UTF-8 decoding
 */
var DecodeUTF8 = /*#__PURE__*/ (function () {
    /**
     * Creates a UTF-8 decoding stream
     * @param cb The callback to call whenever data is decoded
     */
    function DecodeUTF8(cb) {
        this.ondata = cb;
        if (tds)
            this.t = new TextDecoder();
        else
            this.p = et;
    }
    /**
     * Pushes a chunk to be decoded from UTF-8 binary
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    DecodeUTF8.prototype.push = function (chunk, final) {
        if (!this.ondata)
            err(5);
        final = !!final;
        if (this.t) {
            this.ondata(this.t.decode(chunk, { stream: true }), final);
            if (final) {
                if (this.t.decode().length)
                    err(8);
                this.t = null;
            }
            return;
        }
        if (!this.p)
            err(4);
        var dat = new u8(this.p.length + chunk.length);
        dat.set(this.p);
        dat.set(chunk, this.p.length);
        var _a = dutf8(dat), s = _a.s, r = _a.r;
        if (final) {
            if (r.length)
                err(8);
            this.p = null;
        }
        else
            this.p = r;
        this.ondata(s, final);
    };
    return DecodeUTF8;
}());

/**
 * Streaming UTF-8 encoding
 */
var EncodeUTF8 = /*#__PURE__*/ (function () {
    /**
     * Creates a UTF-8 decoding stream
     * @param cb The callback to call whenever data is encoded
     */
    function EncodeUTF8(cb) {
        this.ondata = cb;
    }
    /**
     * Pushes a chunk to be encoded to UTF-8
     * @param chunk The string data to push
     * @param final Whether this is the last chunk
     */
    EncodeUTF8.prototype.push = function (chunk, final) {
        if (!this.ondata)
            err(5);
        if (this.d)
            err(4);
        this.ondata(strToU8(chunk), this.d = final || false);
    };
    return EncodeUTF8;
}());

/**
 * Converts a string into a Uint8Array for use with compression/decompression methods
 * @param str The string to encode
 * @param latin1 Whether or not to interpret the data as Latin-1. This should
 *               not need to be true unless decoding a binary string.
 * @returns The string encoded in UTF-8/Latin-1 binary
 */
function strToU8(str, latin1) {
    if (latin1) {
        var ar_1 = new u8(str.length);
        for (var i = 0; i < str.length; ++i)
            ar_1[i] = str.charCodeAt(i);
        return ar_1;
    }
    if (te)
        return te.encode(str);
    var l = str.length;
    var ar = new u8(str.length + (str.length >> 1));
    var ai = 0;
    var w = function (v) { ar[ai++] = v; };
    for (var i = 0; i < l; ++i) {
        if (ai + 5 > ar.length) {
            var n = new u8(ai + 8 + ((l - i) << 1));
            n.set(ar);
            ar = n;
        }
        var c = str.charCodeAt(i);
        if (c < 128 || latin1)
            w(c);
        else if (c < 2048)
            w(192 | (c >> 6)), w(128 | (c & 63));
        else if (c > 55295 && c < 57344)
            c = 65536 + (c & 1023 << 10) | (str.charCodeAt(++i) & 1023),
                w(240 | (c >> 18)), w(128 | ((c >> 12) & 63)), w(128 | ((c >> 6) & 63)), w(128 | (c & 63));
        else
            w(224 | (c >> 12)), w(128 | ((c >> 6) & 63)), w(128 | (c & 63));
    }
    return slc(ar, 0, ai);
}
/**
 * Converts a Uint8Array to a string
 * @param dat The data to decode to string
 * @param latin1 Whether or not to interpret the data as Latin-1. This should
 *               not need to be true unless encoding to binary string.
 * @returns The original UTF-8/Latin-1 string
 */
function strFromU8(dat, latin1) {
    if (latin1) {
        var r = '';
        for (var i = 0; i < dat.length; i += 16384)
            r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
        return r;
    }
    else if (td) {
        return td.decode(dat);
    }
    else {
        var _a = dutf8(dat), s = _a.s, r = _a.r;
        if (r.length)
            err(8);
        return s;
    }
}
;
// deflate bit flag
var dbf = function (l) { return l == 1 ? 3 : l < 6 ? 2 : l == 9 ? 1 : 0; };
// skip local zip header
var slzh = function (d, b) { return b + 30 + b2(d, b + 26) + b2(d, b + 28); };
// read zip header
var zh = function (d, b, z) {
    var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
    var _a = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a[0], su = _a[1], off = _a[2];
    return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
// read zip64 extra field
var z64e = function (d, b) {
    for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
        ;
    return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
// extra field length
var exfl = function (ex) {
    var le = 0;
    if (ex) {
        for (var k in ex) {
            var l = ex[k].length;
            if (l > 65535)
                err(9);
            le += l + 4;
        }
    }
    return le;
};
// write zip header
var wzh = function (d, b, f, fn, u, c, ce, co) {
    var fl = fn.length, ex = f.extra, col = co && co.length;
    var exl = exfl(ex);
    wbytes(d, b, ce != null ? 0x2014B50 : 0x4034B50), b += 4;
    if (ce != null)
        d[b++] = 20, d[b++] = f.os;
    d[b] = 20, b += 2; // spec compliance? what's that?
    d[b++] = (f.flag << 1) | (c < 0 && 8), d[b++] = u && 8;
    d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
    var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
    if (y < 0 || y > 119)
        err(10);
    wbytes(d, b, (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) | (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1)), b += 4;
    if (c != -1) {
        wbytes(d, b, f.crc);
        wbytes(d, b + 4, c < 0 ? -c - 2 : c);
        wbytes(d, b + 8, f.size);
    }
    wbytes(d, b + 12, fl);
    wbytes(d, b + 14, exl), b += 16;
    if (ce != null) {
        wbytes(d, b, col);
        wbytes(d, b + 6, f.attrs);
        wbytes(d, b + 10, ce), b += 14;
    }
    d.set(fn, b);
    b += fl;
    if (exl) {
        for (var k in ex) {
            var exf = ex[k], l = exf.length;
            wbytes(d, b, +k);
            wbytes(d, b + 2, l);
            d.set(exf, b + 4), b += 4 + l;
        }
    }
    if (col)
        d.set(co, b), b += col;
    return b;
};
// write zip footer (end of central directory)
var wzf = function (o, b, c, d, e) {
    wbytes(o, b, 0x6054B50); // skip disk
    wbytes(o, b + 8, c);
    wbytes(o, b + 10, c);
    wbytes(o, b + 12, d);
    wbytes(o, b + 16, e);
};
/**
 * A pass-through stream to keep data uncompressed in a ZIP archive.
 */
var ZipPassThrough = /*#__PURE__*/ (function () {
    /**
     * Creates a pass-through stream that can be added to ZIP archives
     * @param filename The filename to associate with this data stream
     */
    function ZipPassThrough(filename) {
        this.filename = filename;
        this.c = crc();
        this.size = 0;
        this.compression = 0;
    }
    /**
     * Processes a chunk and pushes to the output stream. You can override this
     * method in a subclass for custom behavior, but by default this passes
     * the data through. You must call this.ondata(err, chunk, final) at some
     * point in this method.
     * @param chunk The chunk to process
     * @param final Whether this is the last chunk
     */
    ZipPassThrough.prototype.process = function (chunk, final) {
        this.ondata(null, chunk, final);
    };
    /**
     * Pushes a chunk to be added. If you are subclassing this with a custom
     * compression algorithm, note that you must push data from the source
     * file only, pre-compression.
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    ZipPassThrough.prototype.push = function (chunk, final) {
        if (!this.ondata)
            err(5);
        this.c.p(chunk);
        this.size += chunk.length;
        if (final)
            this.crc = this.c.d();
        this.process(chunk, final || false);
    };
    return ZipPassThrough;
}());

// I don't extend because TypeScript extension adds 1kB of runtime bloat
/**
 * Streaming DEFLATE compression for ZIP archives. Prefer using AsyncZipDeflate
 * for better performance
 */
var ZipDeflate = /*#__PURE__*/ (function () {
    /**
     * Creates a DEFLATE stream that can be added to ZIP archives
     * @param filename The filename to associate with this data stream
     * @param opts The compression options
     */
    function ZipDeflate(filename, opts) {
        var _this = this;
        if (!opts)
            opts = {};
        ZipPassThrough.call(this, filename);
        this.d = new Deflate(opts, function (dat, final) {
            _this.ondata(null, dat, final);
        });
        this.compression = 8;
        this.flag = dbf(opts.level);
    }
    ZipDeflate.prototype.process = function (chunk, final) {
        try {
            this.d.push(chunk, final);
        }
        catch (e) {
            this.ondata(e, null, final);
        }
    };
    /**
     * Pushes a chunk to be deflated
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    ZipDeflate.prototype.push = function (chunk, final) {
        ZipPassThrough.prototype.push.call(this, chunk, final);
    };
    return ZipDeflate;
}());

/**
 * Asynchronous streaming DEFLATE compression for ZIP archives
 */
var AsyncZipDeflate = /*#__PURE__*/ (function () {
    /**
     * Creates an asynchronous DEFLATE stream that can be added to ZIP archives
     * @param filename The filename to associate with this data stream
     * @param opts The compression options
     */
    function AsyncZipDeflate(filename, opts) {
        var _this = this;
        if (!opts)
            opts = {};
        ZipPassThrough.call(this, filename);
        this.d = new AsyncDeflate(opts, function (err, dat, final) {
            _this.ondata(err, dat, final);
        });
        this.compression = 8;
        this.flag = dbf(opts.level);
        this.terminate = this.d.terminate;
    }
    AsyncZipDeflate.prototype.process = function (chunk, final) {
        this.d.push(chunk, final);
    };
    /**
     * Pushes a chunk to be deflated
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    AsyncZipDeflate.prototype.push = function (chunk, final) {
        ZipPassThrough.prototype.push.call(this, chunk, final);
    };
    return AsyncZipDeflate;
}());

// TODO: Better tree shaking
/**
 * A zippable archive to which files can incrementally be added
 */
var Zip = /*#__PURE__*/ (function () {
    /**
     * Creates an empty ZIP archive to which files can be added
     * @param cb The callback to call whenever data for the generated ZIP archive
     *           is available
     */
    function Zip(cb) {
        this.ondata = cb;
        this.u = [];
        this.d = 1;
    }
    /**
     * Adds a file to the ZIP archive
     * @param file The file stream to add
     */
    Zip.prototype.add = function (file) {
        var _this = this;
        if (!this.ondata)
            err(5);
        // finishing or finished
        if (this.d & 2)
            this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, false);
        else {
            var f = strToU8(file.filename), fl_1 = f.length;
            var com = file.comment, o = com && strToU8(com);
            var u = fl_1 != file.filename.length || (o && (com.length != o.length));
            var hl_1 = fl_1 + exfl(file.extra) + 30;
            if (fl_1 > 65535)
                this.ondata(err(11, 0, 1), null, false);
            var header = new u8(hl_1);
            wzh(header, 0, file, f, u, -1);
            var chks_1 = [header];
            var pAll_1 = function () {
                for (var _i = 0, chks_2 = chks_1; _i < chks_2.length; _i++) {
                    var chk = chks_2[_i];
                    _this.ondata(null, chk, false);
                }
                chks_1 = [];
            };
            var tr_1 = this.d;
            this.d = 0;
            var ind_1 = this.u.length;
            var uf_1 = mrg(file, {
                f: f,
                u: u,
                o: o,
                t: function () {
                    if (file.terminate)
                        file.terminate();
                },
                r: function () {
                    pAll_1();
                    if (tr_1) {
                        var nxt = _this.u[ind_1 + 1];
                        if (nxt)
                            nxt.r();
                        else
                            _this.d = 1;
                    }
                    tr_1 = 1;
                }
            });
            var cl_1 = 0;
            file.ondata = function (err, dat, final) {
                if (err) {
                    _this.ondata(err, dat, final);
                    _this.terminate();
                }
                else {
                    cl_1 += dat.length;
                    chks_1.push(dat);
                    if (final) {
                        var dd = new u8(16);
                        wbytes(dd, 0, 0x8074B50);
                        wbytes(dd, 4, file.crc);
                        wbytes(dd, 8, cl_1);
                        wbytes(dd, 12, file.size);
                        chks_1.push(dd);
                        uf_1.c = cl_1, uf_1.b = hl_1 + cl_1 + 16, uf_1.crc = file.crc, uf_1.size = file.size;
                        if (tr_1)
                            uf_1.r();
                        tr_1 = 1;
                    }
                    else if (tr_1)
                        pAll_1();
                }
            };
            this.u.push(uf_1);
        }
    };
    /**
     * Ends the process of adding files and prepares to emit the final chunks.
     * This *must* be called after adding all desired files for the resulting
     * ZIP file to work properly.
     */
    Zip.prototype.end = function () {
        var _this = this;
        if (this.d & 2) {
            this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, true);
            return;
        }
        if (this.d)
            this.e();
        else
            this.u.push({
                r: function () {
                    if (!(_this.d & 1))
                        return;
                    _this.u.splice(-1, 1);
                    _this.e();
                },
                t: function () { }
            });
        this.d = 3;
    };
    Zip.prototype.e = function () {
        var bt = 0, l = 0, tl = 0;
        for (var _i = 0, _a = this.u; _i < _a.length; _i++) {
            var f = _a[_i];
            tl += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0);
        }
        var out = new u8(tl + 22);
        for (var _b = 0, _c = this.u; _b < _c.length; _b++) {
            var f = _c[_b];
            wzh(out, bt, f, f.f, f.u, -f.c - 2, l, f.o);
            bt += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0), l += f.b;
        }
        wzf(out, bt, this.u.length, tl, l);
        this.ondata(null, out, true);
        this.d = 2;
    };
    /**
     * A method to terminate any internal workers used by the stream. Subsequent
     * calls to add() will fail.
     */
    Zip.prototype.terminate = function () {
        for (var _i = 0, _a = this.u; _i < _a.length; _i++) {
            var f = _a[_i];
            f.t();
        }
        this.d = 2;
    };
    return Zip;
}());

function zip(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    var r = {};
    fltn(data, '', r, opts);
    var k = Object.keys(r);
    var lft = k.length, o = 0, tot = 0;
    var slft = lft, files = new Array(lft);
    var term = [];
    var tAll = function () {
        for (var i = 0; i < term.length; ++i)
            term[i]();
    };
    var cbd = function (a, b) {
        mt(function () { cb(a, b); });
    };
    mt(function () { cbd = cb; });
    var cbf = function () {
        var out = new u8(tot + 22), oe = o, cdl = tot - o;
        tot = 0;
        for (var i = 0; i < slft; ++i) {
            var f = files[i];
            try {
                var l = f.c.length;
                wzh(out, tot, f, f.f, f.u, l);
                var badd = 30 + f.f.length + exfl(f.extra);
                var loc = tot + badd;
                out.set(f.c, loc);
                wzh(out, o, f, f.f, f.u, l, tot, f.m), o += 16 + badd + (f.m ? f.m.length : 0), tot = loc + l;
            }
            catch (e) {
                return cbd(e, null);
            }
        }
        wzf(out, o, files.length, cdl, oe);
        cbd(null, out);
    };
    if (!lft)
        cbf();
    var _loop_1 = function (i) {
        var fn = k[i];
        var _a = r[fn], file = _a[0], p = _a[1];
        var c = crc(), size = file.length;
        c.p(file);
        var f = strToU8(fn), s = f.length;
        var com = p.comment, m = com && strToU8(com), ms = m && m.length;
        var exl = exfl(p.extra);
        var compression = p.level == 0 ? 0 : 8;
        var cbl = function (e, d) {
            if (e) {
                tAll();
                cbd(e, null);
            }
            else {
                var l = d.length;
                files[i] = mrg(p, {
                    size: size,
                    crc: c.d(),
                    c: d,
                    f: f,
                    m: m,
                    u: s != fn.length || (m && (com.length != ms)),
                    compression: compression
                });
                o += 30 + s + exl + l;
                tot += 76 + 2 * (s + exl) + (ms || 0) + l;
                if (!--lft)
                    cbf();
            }
        };
        if (s > 65535)
            cbl(err(11, 0, 1), null);
        if (!compression)
            cbl(null, file);
        else if (size < 160000) {
            try {
                cbl(null, deflateSync(file, p));
            }
            catch (e) {
                cbl(e, null);
            }
        }
        else
            term.push(deflate(file, p, cbl));
    };
    // Cannot use lft because it can decrease
    for (var i = 0; i < slft; ++i) {
        _loop_1(i);
    }
    return tAll;
}
/**
 * Synchronously creates a ZIP file. Prefer using `zip` for better performance
 * with more than one file.
 * @param data The directory structure for the ZIP archive
 * @param opts The main options, merged with per-file options
 * @returns The generated ZIP archive
 */
function zipSync(data, opts) {
    if (!opts)
        opts = {};
    var r = {};
    var files = [];
    fltn(data, '', r, opts);
    var o = 0;
    var tot = 0;
    for (var fn in r) {
        var _a = r[fn], file = _a[0], p = _a[1];
        var compression = p.level == 0 ? 0 : 8;
        var f = strToU8(fn), s = f.length;
        var com = p.comment, m = com && strToU8(com), ms = m && m.length;
        var exl = exfl(p.extra);
        if (s > 65535)
            err(11);
        var d = compression ? deflateSync(file, p) : file, l = d.length;
        var c = crc();
        c.p(file);
        files.push(mrg(p, {
            size: file.length,
            crc: c.d(),
            c: d,
            f: f,
            m: m,
            u: s != fn.length || (m && (com.length != ms)),
            o: o,
            compression: compression
        }));
        o += 30 + s + exl + l;
        tot += 76 + 2 * (s + exl) + (ms || 0) + l;
    }
    var out = new u8(tot + 22), oe = o, cdl = tot - o;
    for (var i = 0; i < files.length; ++i) {
        var f = files[i];
        wzh(out, f.o, f, f.f, f.u, f.c.length);
        var badd = 30 + f.f.length + exfl(f.extra);
        out.set(f.c, f.o + badd);
        wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
    }
    wzf(out, o, files.length, cdl, oe);
    return out;
}
/**
 * Streaming pass-through decompression for ZIP archives
 */
var UnzipPassThrough = /*#__PURE__*/ (function () {
    function UnzipPassThrough() {
    }
    UnzipPassThrough.prototype.push = function (data, final) {
        this.ondata(null, data, final);
    };
    UnzipPassThrough.compression = 0;
    return UnzipPassThrough;
}());

/**
 * Streaming DEFLATE decompression for ZIP archives. Prefer AsyncZipInflate for
 * better performance.
 */
var UnzipInflate = /*#__PURE__*/ (function () {
    /**
     * Creates a DEFLATE decompression that can be used in ZIP archives
     */
    function UnzipInflate() {
        var _this = this;
        this.i = new Inflate(function (dat, final) {
            _this.ondata(null, dat, final);
        });
    }
    UnzipInflate.prototype.push = function (data, final) {
        try {
            this.i.push(data, final);
        }
        catch (e) {
            this.ondata(e, null, final);
        }
    };
    UnzipInflate.compression = 8;
    return UnzipInflate;
}());

/**
 * Asynchronous streaming DEFLATE decompression for ZIP archives
 */
var AsyncUnzipInflate = /*#__PURE__*/ (function () {
    /**
     * Creates a DEFLATE decompression that can be used in ZIP archives
     */
    function AsyncUnzipInflate(_, sz) {
        var _this = this;
        if (sz < 320000) {
            this.i = new Inflate(function (dat, final) {
                _this.ondata(null, dat, final);
            });
        }
        else {
            this.i = new AsyncInflate(function (err, dat, final) {
                _this.ondata(err, dat, final);
            });
            this.terminate = this.i.terminate;
        }
    }
    AsyncUnzipInflate.prototype.push = function (data, final) {
        if (this.i.terminate)
            data = slc(data, 0);
        this.i.push(data, final);
    };
    AsyncUnzipInflate.compression = 8;
    return AsyncUnzipInflate;
}());

/**
 * A ZIP archive decompression stream that emits files as they are discovered
 */
var Unzip = /*#__PURE__*/ (function () {
    /**
     * Creates a ZIP decompression stream
     * @param cb The callback to call whenever a file in the ZIP archive is found
     */
    function Unzip(cb) {
        this.onfile = cb;
        this.k = [];
        this.o = {
            0: UnzipPassThrough
        };
        this.p = et;
    }
    /**
     * Pushes a chunk to be unzipped
     * @param chunk The chunk to push
     * @param final Whether this is the last chunk
     */
    Unzip.prototype.push = function (chunk, final) {
        var _this = this;
        if (!this.onfile)
            err(5);
        if (!this.p)
            err(4);
        if (this.c > 0) {
            var len = Math.min(this.c, chunk.length);
            var toAdd = chunk.subarray(0, len);
            this.c -= len;
            if (this.d)
                this.d.push(toAdd, !this.c);
            else
                this.k[0].push(toAdd);
            chunk = chunk.subarray(len);
            if (chunk.length)
                return this.push(chunk, final);
        }
        else {
            var f = 0, i = 0, is = void 0, buf = void 0;
            if (!this.p.length)
                buf = chunk;
            else if (!chunk.length)
                buf = this.p;
            else {
                buf = new u8(this.p.length + chunk.length);
                buf.set(this.p), buf.set(chunk, this.p.length);
            }
            var l = buf.length, oc = this.c, add = oc && this.d;
            var _loop_2 = function () {
                var _a;
                var sig = b4(buf, i);
                if (sig == 0x4034B50) {
                    f = 1, is = i;
                    this_1.d = null;
                    this_1.c = 0;
                    var bf = b2(buf, i + 6), cmp_1 = b2(buf, i + 8), u = bf & 2048, dd = bf & 8, fnl = b2(buf, i + 26), es = b2(buf, i + 28);
                    if (l > i + 30 + fnl + es) {
                        var chks_3 = [];
                        this_1.k.unshift(chks_3);
                        f = 2;
                        var sc_1 = b4(buf, i + 18), su_1 = b4(buf, i + 22);
                        var fn_1 = strFromU8(buf.subarray(i + 30, i += 30 + fnl), !u);
                        if (sc_1 == 4294967295) {
                            _a = dd ? [-2] : z64e(buf, i), sc_1 = _a[0], su_1 = _a[1];
                        }
                        else if (dd)
                            sc_1 = -1;
                        i += es;
                        this_1.c = sc_1;
                        var d_1;
                        var file_1 = {
                            name: fn_1,
                            compression: cmp_1,
                            start: function () {
                                if (!file_1.ondata)
                                    err(5);
                                if (!sc_1)
                                    file_1.ondata(null, et, true);
                                else {
                                    var ctr = _this.o[cmp_1];
                                    if (!ctr)
                                        file_1.ondata(err(14, 'unknown compression type ' + cmp_1, 1), null, false);
                                    d_1 = sc_1 < 0 ? new ctr(fn_1) : new ctr(fn_1, sc_1, su_1);
                                    d_1.ondata = function (err, dat, final) { file_1.ondata(err, dat, final); };
                                    for (var _i = 0, chks_4 = chks_3; _i < chks_4.length; _i++) {
                                        var dat = chks_4[_i];
                                        d_1.push(dat, false);
                                    }
                                    if (_this.k[0] == chks_3 && _this.c)
                                        _this.d = d_1;
                                    else
                                        d_1.push(et, true);
                                }
                            },
                            terminate: function () {
                                if (d_1 && d_1.terminate)
                                    d_1.terminate();
                            }
                        };
                        if (sc_1 >= 0)
                            file_1.size = sc_1, file_1.originalSize = su_1;
                        this_1.onfile(file_1);
                    }
                    return "break";
                }
                else if (oc) {
                    if (sig == 0x8074B50) {
                        is = i += 12 + (oc == -2 && 8), f = 3, this_1.c = 0;
                        return "break";
                    }
                    else if (sig == 0x2014B50) {
                        is = i -= 4, f = 3, this_1.c = 0;
                        return "break";
                    }
                }
            };
            var this_1 = this;
            for (; i < l - 4; ++i) {
                var state_1 = _loop_2();
                if (state_1 === "break")
                    break;
            }
            this.p = et;
            if (oc < 0) {
                var dat = f ? buf.subarray(0, is - 12 - (oc == -2 && 8) - (b4(buf, is - 16) == 0x8074B50 && 4)) : buf.subarray(0, i);
                if (add)
                    add.push(dat, !!f);
                else
                    this.k[+(f == 2)].push(dat);
            }
            if (f & 2)
                return this.push(buf.subarray(i), final);
            this.p = buf.subarray(i);
        }
        if (final) {
            if (this.c)
                err(13);
            this.p = null;
        }
    };
    /**
     * Registers a decoder with the stream, allowing for files compressed with
     * the compression type provided to be expanded correctly
     * @param decoder The decoder constructor
     */
    Unzip.prototype.register = function (decoder) {
        this.o[decoder.compression] = decoder;
    };
    return Unzip;
}());

var mt = typeof queueMicrotask == 'function' ? queueMicrotask : typeof setTimeout == 'function' ? setTimeout : function (fn) { fn(); };
function unzip(data, opts, cb) {
    if (!cb)
        cb = opts, opts = {};
    if (typeof cb != 'function')
        err(7);
    var term = [];
    var tAll = function () {
        for (var i = 0; i < term.length; ++i)
            term[i]();
    };
    var files = {};
    var cbd = function (a, b) {
        mt(function () { cb(a, b); });
    };
    mt(function () { cbd = cb; });
    var e = data.length - 22;
    for (; b4(data, e) != 0x6054B50; --e) {
        if (!e || data.length - e > 65558) {
            cbd(err(13, 0, 1), null);
            return tAll;
        }
    }
    ;
    var lft = b2(data, e + 8);
    if (lft) {
        var c = lft;
        var o = b4(data, e + 16);
        var z = o == 4294967295 || c == 65535;
        if (z) {
            var ze = b4(data, e - 12);
            z = b4(data, ze) == 0x6064B50;
            if (z) {
                c = lft = b4(data, ze + 32);
                o = b4(data, ze + 48);
            }
        }
        var fltr = opts && opts.filter;
        var _loop_3 = function (i) {
            var _a = zh(data, o, z), c_1 = _a[0], sc = _a[1], su = _a[2], fn = _a[3], no = _a[4], off = _a[5], b = slzh(data, off);
            o = no;
            var cbl = function (e, d) {
                if (e) {
                    tAll();
                    cbd(e, null);
                }
                else {
                    if (d)
                        files[fn] = d;
                    if (!--lft)
                        cbd(null, files);
                }
            };
            if (!fltr || fltr({
                name: fn,
                size: sc,
                originalSize: su,
                compression: c_1
            })) {
                if (!c_1)
                    cbl(null, slc(data, b, b + sc));
                else if (c_1 == 8) {
                    var infl = data.subarray(b, b + sc);
                    // Synchronously decompress under 512KB, or barely-compressed data
                    if (su < 524288 || sc > 0.8 * su) {
                        try {
                            cbl(null, inflateSync(infl, { out: new u8(su) }));
                        }
                        catch (e) {
                            cbl(e, null);
                        }
                    }
                    else
                        term.push(inflate(infl, { size: su }, cbl));
                }
                else
                    cbl(err(14, 'unknown compression type ' + c_1, 1), null);
            }
            else
                cbl(null, null);
        };
        for (var i = 0; i < c; ++i) {
            _loop_3(i);
        }
    }
    else
        cbd(null, {});
    return tAll;
}
/**
 * Synchronously decompresses a ZIP archive. Prefer using `unzip` for better
 * performance with more than one file.
 * @param data The raw compressed ZIP file
 * @param opts The ZIP extraction options
 * @returns The decompressed files
 */
function unzipSync(data, opts) {
    var files = {};
    var e = data.length - 22;
    for (; b4(data, e) != 0x6054B50; --e) {
        if (!e || data.length - e > 65558)
            err(13);
    }
    ;
    var c = b2(data, e + 8);
    if (!c)
        return {};
    var o = b4(data, e + 16);
    var z = o == 4294967295 || c == 65535;
    if (z) {
        var ze = b4(data, e - 12);
        z = b4(data, ze) == 0x6064B50;
        if (z) {
            c = b4(data, ze + 32);
            o = b4(data, ze + 48);
        }
    }
    var fltr = opts && opts.filter;
    for (var i = 0; i < c; ++i) {
        var _a = zh(data, o, z), c_2 = _a[0], sc = _a[1], su = _a[2], fn = _a[3], no = _a[4], off = _a[5], b = slzh(data, off);
        o = no;
        if (!fltr || fltr({
            name: fn,
            size: sc,
            originalSize: su,
            compression: c_2
        })) {
            if (!c_2)
                files[fn] = slc(data, b, b + sc);
            else if (c_2 == 8)
                files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
            else
                err(14, 'unknown compression type ' + c_2);
        }
    }
    return files;
}
return { unzipSync, zipSync, gzipSync, gunzipSync, Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, ZipPassThrough };
})();

// -- vendor/fzstd.module.mjs (MIT, see ext/archive/vendor/LICENSE-fzstd) --

const fzstd = (() => {
// Some numerical data is initialized as -1 even when it doesn't need initialization to help the JIT infer types
// aliases for shorter compressed code (most minifers don't do this)
var ab = ArrayBuffer, u8 = Uint8Array, u16 = Uint16Array, i16 = Int16Array, u32 = Uint32Array, i32 = Int32Array;
var slc = function (v, s, e) {
    if (u8.prototype.slice)
        return u8.prototype.slice.call(v, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    var n = new u8(e - s);
    n.set(v.subarray(s, e));
    return n;
};
var fill = function (v, n, s, e) {
    if (u8.prototype.fill)
        return u8.prototype.fill.call(v, n, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    for (; s < e; ++s)
        v[s] = n;
    return v;
};
var cpw = function (v, t, s, e) {
    if (u8.prototype.copyWithin)
        return u8.prototype.copyWithin.call(v, t, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    while (s < e) {
        v[t++] = v[s++];
    }
};
/**
 * Codes for errors generated within this library
 */
var ZstdErrorCode = {
    InvalidData: 0,
    WindowSizeTooLarge: 1,
    InvalidBlockType: 2,
    FSEAccuracyTooHigh: 3,
    DistanceTooFarBack: 4,
    UnexpectedEOF: 5
};
// error codes
var ec = [
    'invalid zstd data',
    'window size too large (>2046MB)',
    'invalid block type',
    'FSE accuracy too high',
    'match distance too far back',
    'unexpected EOF'
];
var err = function (ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
        Error.captureStackTrace(e, err);
    if (!nt)
        throw e;
    return e;
};
var rb = function (d, b, n) {
    var i = 0, o = 0;
    for (; i < n; ++i)
        o |= d[b++] << (i << 3);
    return o;
};
var b4 = function (d, b) { return (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0; };
// read Zstandard frame header
var rzfh = function (dat, w) {
    var n3 = dat[0] | (dat[1] << 8) | (dat[2] << 16);
    if (n3 == 0x2FB528 && dat[3] == 253) {
        // Zstandard
        var flg = dat[4];
        //    single segment       checksum             dict flag     frame content flag
        var ss = (flg >> 5) & 1, cc = (flg >> 2) & 1, df = flg & 3, fcf = flg >> 6;
        if (flg & 8)
            err(0);
        // byte
        var bt = 6 - ss;
        // dict bytes
        var db = df == 3 ? 4 : df;
        // dictionary id
        var di = rb(dat, bt, db);
        bt += db;
        // frame size bytes
        var fsb = fcf ? (1 << fcf) : ss;
        // frame source size
        var fss = rb(dat, bt, fsb) + ((fcf == 1) && 256);
        // window size
        var ws = fss;
        if (!ss) {
            // window descriptor
            var wb = 1 << (10 + (dat[5] >> 3));
            ws = wb + (wb >> 3) * (dat[5] & 7);
        }
        if (ws > 2145386496)
            err(1);
        var buf = new u8((w == 1 ? (fss || ws) : w ? 0 : ws) + 12);
        buf[0] = 1, buf[4] = 4, buf[8] = 8;
        return {
            b: bt + fsb,
            y: 0,
            l: 0,
            d: di,
            w: (w && w != 1) ? w : buf.subarray(12),
            e: ws,
            o: new i32(buf.buffer, 0, 3),
            u: fss,
            c: cc,
            m: Math.min(131072, ws)
        };
    }
    else if (((n3 >> 4) | (dat[3] << 20)) == 0x184D2A5) {
        // skippable
        return b4(dat, 4) + 8;
    }
    err(0);
};
// most significant bit for nonzero
var msb = function (val) {
    var bits = 0;
    for (; (1 << bits) <= val; ++bits)
        ;
    return bits - 1;
};
// read finite state entropy
var rfse = function (dat, bt, mal) {
    // table pos
    var tpos = (bt << 3) + 4;
    // accuracy log
    var al = (dat[bt] & 15) + 5;
    if (al > mal)
        err(3);
    // size
    var sz = 1 << al;
    // probabilities symbols  repeat   index   high threshold
    var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
    // optimization: single allocation is much faster
    var buf = new ab(512 + (sz << 2));
    var freq = new i16(buf, 0, 256);
    // same view as freq
    var dstate = new u16(buf, 0, 256);
    var nstate = new u16(buf, 512, sz);
    var bb1 = 512 + (sz << 1);
    var syms = new u8(buf, bb1, sz);
    var nbits = new u8(buf, bb1 + sz);
    while (sym < 255 && probs > 0) {
        var bits = msb(probs + 1);
        var cbt = tpos >> 3;
        // mask
        var msk = (1 << (bits + 1)) - 1;
        var val = ((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (tpos & 7)) & msk;
        // mask (1 fewer bit)
        var msk1fb = (1 << bits) - 1;
        // max small value
        var msv = msk - probs - 1;
        // small value
        var sval = val & msk1fb;
        if (sval < msv)
            tpos += bits, val = sval;
        else {
            tpos += bits + 1;
            if (val > msk1fb)
                val -= msv;
        }
        freq[++sym] = --val;
        if (val == -1) {
            probs += val;
            syms[--ht] = sym;
        }
        else
            probs -= val;
        if (!val) {
            do {
                // repeat byte
                var rbt = tpos >> 3;
                re = ((dat[rbt] | (dat[rbt + 1] << 8)) >> (tpos & 7)) & 3;
                tpos += 2;
                sym += re;
            } while (re == 3);
        }
    }
    if (sym > 255 || probs)
        err(0);
    var sympos = 0;
    // sym step (coprime with sz - formula from zstd source)
    var sstep = (sz >> 1) + (sz >> 3) + 3;
    // sym mask
    var smask = sz - 1;
    for (var s = 0; s <= sym; ++s) {
        var sf = freq[s];
        if (sf < 1) {
            dstate[s] = -sf;
            continue;
        }
        // This is split into two loops in zstd to avoid branching, but as JS is higher-level that is unnecessary
        for (i = 0; i < sf; ++i) {
            syms[sympos] = s;
            do {
                sympos = (sympos + sstep) & smask;
            } while (sympos >= ht);
        }
    }
    // After spreading symbols, should be zero again
    if (sympos)
        err(0);
    for (i = 0; i < sz; ++i) {
        // next state
        var ns = dstate[syms[i]]++;
        // num bits
        var nb = nbits[i] = al - msb(ns);
        nstate[i] = (ns << nb) - sz;
    }
    return [(tpos + 7) >> 3, {
            b: al,
            s: syms,
            n: nbits,
            t: nstate
        }];
};
// read huffman
var rhu = function (dat, bt) {
    //  index  weight count
    var i = 0, wc = -1;
    //    buffer             header byte
    var buf = new u8(292), hb = dat[bt];
    // huffman weights
    var hw = buf.subarray(0, 256);
    // rank count
    var rc = buf.subarray(256, 268);
    // rank index
    var ri = new u16(buf.buffer, 268);
    // NOTE: at this point bt is 1 less than expected
    if (hb < 128) {
        // end byte, fse decode table
        var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
        bt += hb;
        var epos = ebt << 3;
        // last byte
        var lb = dat[bt];
        if (!lb)
            err(0);
        //  state1   state2   state1 bits   state2 bits
        var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
        // fse pos
        // pre-increment to account for original deficit of 1
        var fpos = (++bt << 3) - 8 + msb(lb);
        for (;;) {
            fpos -= btr1;
            if (fpos < epos)
                break;
            var cbt = fpos >> 3;
            st1 += ((dat[cbt] | (dat[cbt + 1] << 8)) >> (fpos & 7)) & ((1 << btr1) - 1);
            hw[++wc] = fdt.s[st1];
            fpos -= btr2;
            if (fpos < epos)
                break;
            cbt = fpos >> 3;
            st2 += ((dat[cbt] | (dat[cbt + 1] << 8)) >> (fpos & 7)) & ((1 << btr2) - 1);
            hw[++wc] = fdt.s[st2];
            btr1 = fdt.n[st1];
            st1 = fdt.t[st1];
            btr2 = fdt.n[st2];
            st2 = fdt.t[st2];
        }
        if (++wc > 255)
            err(0);
    }
    else {
        wc = hb - 127;
        for (; i < wc; i += 2) {
            var byte = dat[++bt];
            hw[i] = byte >> 4;
            hw[i + 1] = byte & 15;
        }
        ++bt;
    }
    // weight exponential sum
    var wes = 0;
    for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        // bits must be at most 11, same as weight
        if (wt > 11)
            err(0);
        wes += wt && (1 << (wt - 1));
    }
    // max bits
    var mb = msb(wes) + 1;
    // table size
    var ts = 1 << mb;
    // remaining sum
    var rem = ts - wes;
    // must be power of 2
    if (rem & (rem - 1))
        err(0);
    hw[wc++] = msb(rem) + 1;
    for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        ++rc[hw[i] = wt && (mb + 1 - wt)];
    }
    // huf buf
    var hbuf = new u8(ts << 1);
    //    symbols                      num bits
    var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
    ri[mb] = 0;
    for (i = mb; i > 0; --i) {
        var pv = ri[i];
        fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << (mb - i)));
    }
    if (ri[0] != ts)
        err(0);
    for (i = 0; i < wc; ++i) {
        var bits = hw[i];
        if (bits) {
            var code = ri[bits];
            fill(syms, i, code, ri[bits] = code + (1 << (mb - bits)));
        }
    }
    return [bt, {
            n: nb,
            b: mb,
            s: syms
        }];
};
// Tables generated using this:
// https://gist.github.com/101arrowz/a979452d4355992cbf8f257cbffc9edd
// default literal length table
var dllt = /*#__PURE__*/ rfse(/*#__PURE__*/ new u8([
    81, 16, 99, 140, 49, 198, 24, 99, 12, 33, 196, 24, 99, 102, 102, 134, 70, 146, 4
]), 0, 6)[1];
// default match length table
var dmlt = /*#__PURE__*/ rfse(/*#__PURE__*/ new u8([
    33, 20, 196, 24, 99, 140, 33, 132, 16, 66, 8, 33, 132, 16, 66, 8, 33, 68, 68, 68, 68, 68, 68, 68, 68, 36, 9
]), 0, 6)[1];
// default offset code table
var doct = /*#__PURE__ */ rfse(/*#__PURE__*/ new u8([
    32, 132, 16, 66, 102, 70, 68, 68, 68, 68, 36, 73, 2
]), 0, 5)[1];
// bits to baseline
var b2bl = function (b, s) {
    var len = b.length, bl = new i32(len);
    for (var i = 0; i < len; ++i) {
        bl[i] = s;
        s += 1 << b[i];
    }
    return bl;
};
// literal length bits
var llb = /*#__PURE__ */ new u8(( /*#__PURE__ */new i32([
    0, 0, 0, 0, 16843009, 50528770, 134678020, 202050057, 269422093
])).buffer, 0, 36);
// literal length baseline
var llbl = /*#__PURE__ */ b2bl(llb, 0);
// match length bits
var mlb = /*#__PURE__ */ new u8(( /*#__PURE__ */new i32([
    0, 0, 0, 0, 0, 0, 0, 0, 16843009, 50528770, 117769220, 185207048, 252579084, 16
])).buffer, 0, 53);
// match length baseline
var mlbl = /*#__PURE__ */ b2bl(mlb, 3);
// decode huffman stream
var dhu = function (dat, out, hu) {
    var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
    if (!lb)
        err(0);
    var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
    for (; pos > eb && i < ss;) {
        var cbt = pos >> 3;
        var val = (dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (pos & 7);
        st = ((st << btr) | val) & msk;
        out[++i] = hu.s[st];
        pos -= (btr = hu.n[st]);
    }
    if (pos != eb || i + 1 != ss)
        err(0);
};
// decode huffman stream 4x
// TODO: use workers to parallelize
var dhu4 = function (dat, out, hu) {
    var bt = 6;
    var ss = out.length, sz1 = (ss + 3) >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
    dhu(dat.subarray(bt, bt += dat[0] | (dat[1] << 8)), out.subarray(0, sz1), hu);
    dhu(dat.subarray(bt, bt += dat[2] | (dat[3] << 8)), out.subarray(sz1, sz2), hu);
    dhu(dat.subarray(bt, bt += dat[4] | (dat[5] << 8)), out.subarray(sz2, sz3), hu);
    dhu(dat.subarray(bt), out.subarray(sz3), hu);
};
// read Zstandard block
var rzb = function (dat, st, out) {
    var _a;
    var bt = st.b;
    //    byte 0        block type
    var b0 = dat[bt], btype = (b0 >> 1) & 3;
    st.l = b0 & 1;
    var sz = (b0 >> 3) | (dat[bt + 1] << 5) | (dat[bt + 2] << 13);
    // end byte for block
    var ebt = (bt += 3) + sz;
    if (btype == 1) {
        if (bt >= dat.length)
            return;
        st.b = bt + 1;
        if (out) {
            fill(out, dat[bt], st.y, st.y += sz);
            return out;
        }
        return fill(new u8(sz), dat[bt]);
    }
    if (ebt > dat.length)
        return;
    if (btype == 0) {
        st.b = ebt;
        if (out) {
            out.set(dat.subarray(bt, ebt), st.y);
            st.y += sz;
            return out;
        }
        return slc(dat, bt, ebt);
    }
    if (btype == 2) {
        //    byte 3        lit btype     size format
        var b3 = dat[bt], lbt = b3 & 3, sf = (b3 >> 2) & 3;
        // lit src size  lit cmp sz 4 streams
        var lss = b3 >> 4, lcs = 0, s4 = 0;
        if (lbt < 2) {
            if (sf & 1)
                lss |= (dat[++bt] << 4) | ((sf & 2) && (dat[++bt] << 12));
            else
                lss = b3 >> 3;
        }
        else {
            s4 = sf;
            if (sf < 2)
                lss |= ((dat[++bt] & 63) << 4), lcs = (dat[bt] >> 6) | (dat[++bt] << 2);
            else if (sf == 2)
                lss |= (dat[++bt] << 4) | ((dat[++bt] & 3) << 12), lcs = (dat[bt] >> 2) | (dat[++bt] << 6);
            else
                lss |= (dat[++bt] << 4) | ((dat[++bt] & 63) << 12), lcs = (dat[bt] >> 6) | (dat[++bt] << 2) | (dat[++bt] << 10);
        }
        ++bt;
        // add literals to end - can never overlap with backreferences because unused literals always appended
        var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
        // starting point for literals
        var spl = buf.length - lss;
        if (lbt == 0)
            buf.set(dat.subarray(bt, bt += lss), spl);
        else if (lbt == 1)
            fill(buf, dat[bt++], spl);
        else {
            // huffman table
            var hu = st.h;
            if (lbt == 2) {
                var hud = rhu(dat, bt);
                // subtract description length
                lcs += bt - (bt = hud[0]);
                st.h = hu = hud[1];
            }
            else if (!hu)
                err(0);
            (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
        }
        // num sequences
        var ns = dat[bt++];
        if (ns) {
            if (ns == 255)
                ns = (dat[bt++] | (dat[bt++] << 8)) + 0x7F00;
            else if (ns > 127)
                ns = ((ns - 128) << 8) | dat[bt++];
            // symbol compression modes
            var scm = dat[bt++];
            if (scm & 3)
                err(0);
            var dts = [dmlt, doct, dllt];
            for (var i = 2; i > -1; --i) {
                var md = (scm >> ((i << 1) + 2)) & 3;
                if (md == 1) {
                    // rle buf
                    var rbuf = new u8([0, 0, dat[bt++]]);
                    dts[i] = {
                        s: rbuf.subarray(2, 3),
                        n: rbuf.subarray(0, 1),
                        t: new u16(rbuf.buffer, 0, 1),
                        b: 0
                    };
                }
                else if (md == 2) {
                    // accuracy log 8 for offsets, 9 for others
                    _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
                }
                else if (md == 3) {
                    if (!st.t)
                        err(0);
                    dts[i] = st.t[i];
                }
            }
            var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
            var lb = dat[ebt - 1];
            if (!lb)
                err(0);
            var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
            var lst = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << llt.b) - 1);
            cbt = (spos -= oct.b) >> 3;
            var ost = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << oct.b) - 1);
            cbt = (spos -= mlt.b) >> 3;
            var mst = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << mlt.b) - 1);
            for (++ns; --ns;) {
                var llc = llt.s[lst];
                var lbtr = llt.n[lst];
                var mlc = mlt.s[mst];
                var mbtr = mlt.n[mst];
                var ofc = oct.s[ost];
                var obtr = oct.n[ost];
                cbt = (spos -= ofc) >> 3;
                var ofp = 1 << ofc;
                var off = ofp + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16) | (dat[cbt + 3] << 24)) >>> (spos & 7)) & (ofp - 1));
                cbt = (spos -= mlb[mlc]) >> 3;
                var ml = mlbl[mlc] + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (spos & 7)) & ((1 << mlb[mlc]) - 1));
                cbt = (spos -= llb[llc]) >> 3;
                var ll = llbl[llc] + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (spos & 7)) & ((1 << llb[llc]) - 1));
                cbt = (spos -= lbtr) >> 3;
                lst = llt.t[lst] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << lbtr) - 1));
                cbt = (spos -= mbtr) >> 3;
                mst = mlt.t[mst] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << mbtr) - 1));
                cbt = (spos -= obtr) >> 3;
                ost = oct.t[ost] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << obtr) - 1));
                if (off > 3) {
                    st.o[2] = st.o[1];
                    st.o[1] = st.o[0];
                    st.o[0] = off -= 3;
                }
                else {
                    var idx = off - (ll != 0);
                    if (idx) {
                        off = idx == 3 ? st.o[0] - 1 : st.o[idx];
                        if (idx > 1)
                            st.o[2] = st.o[1];
                        st.o[1] = st.o[0];
                        st.o[0] = off;
                    }
                    else
                        off = st.o[0];
                }
                for (var i = 0; i < ll; ++i) {
                    buf[oubt + i] = buf[spl + i];
                }
                oubt += ll, spl += ll;
                var stin = oubt - off;
                if (stin < 0) {
                    var len = -stin;
                    var bs = st.e + stin;
                    if (len > ml)
                        len = ml;
                    for (var i = 0; i < len; ++i) {
                        buf[oubt + i] = st.w[bs + i];
                    }
                    oubt += len, ml -= len, stin = 0;
                }
                for (var i = 0; i < ml; ++i) {
                    buf[oubt + i] = buf[stin + i];
                }
                oubt += ml;
            }
            if (oubt != spl) {
                while (spl < buf.length) {
                    buf[oubt++] = buf[spl++];
                }
            }
            else
                oubt = buf.length;
            if (out)
                st.y += oubt;
            else
                buf = slc(buf, 0, oubt);
        }
        else if (out) {
            st.y += lss;
            if (spl) {
                for (var i = 0; i < lss; ++i) {
                    buf[i] = buf[spl + i];
                }
            }
        }
        else if (spl)
            buf = slc(buf, spl);
        st.b = ebt;
        return buf;
    }
    err(2);
};
// concat
var cct = function (bufs, ol) {
    if (bufs.length == 1)
        return bufs[0];
    var buf = new u8(ol);
    for (var i = 0, b = 0; i < bufs.length; ++i) {
        var chk = bufs[i];
        buf.set(chk, b);
        b += chk.length;
    }
    return buf;
};
/**
 * Decompresses Zstandard data
 * @param dat The input data
 * @param buf The output buffer. If unspecified, the function will allocate
 *            exactly enough memory to fit the decompressed data. If your
 *            data has multiple frames and you know the output size, specifying
 *            it will yield better performance.
 * @returns The decompressed data
 */
function decompress(dat, buf) {
    var bufs = [], nb = +!buf;
    var bt = 0, ol = 0;
    for (; dat.length;) {
        var st = rzfh(dat, nb || buf);
        if (typeof st == 'object') {
            if (nb) {
                buf = null;
                if (st.w.length == st.u) {
                    bufs.push(buf = st.w);
                    ol += st.u;
                }
            }
            else {
                bufs.push(buf);
                st.e = 0;
            }
            for (; !st.l;) {
                var blk = rzb(dat, st, buf);
                if (!blk)
                    err(5);
                if (buf)
                    st.e = st.y;
                else {
                    bufs.push(blk);
                    ol += blk.length;
                    cpw(st.w, 0, blk.length);
                    st.w.set(blk, st.w.length - blk.length);
                }
            }
            bt = st.b + (st.c * 4);
        }
        else
            bt = st;
        dat = dat.subarray(bt);
    }
    return cct(bufs, ol);
}
/**
 * Decompressor for Zstandard streamed data
 */
var Decompress = /*#__PURE__*/ (function () {
    /**
     * Creates a Zstandard decompressor
     * @param ondata The handler for stream data
     */
    function Decompress(ondata) {
        this.ondata = ondata;
        this.c = [];
        this.l = 0;
        this.z = 0;
    }
    /**
     * Pushes data to be decompressed
     * @param chunk The chunk of data to push
     * @param final Whether or not this is the last chunk in the stream
     */
    Decompress.prototype.push = function (chunk, final) {
        if (typeof this.s == 'number') {
            var sub = Math.min(chunk.length, this.s);
            chunk = chunk.subarray(sub);
            this.s -= sub;
        }
        var sl = chunk.length;
        var ncs = sl + this.l;
        if (!this.s) {
            if (final) {
                if (!ncs) {
                    this.ondata(new u8(0), true);
                    return;
                }
                // min for frame + one block
                if (ncs < 5)
                    err(5);
            }
            else if (ncs < 18) {
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (typeof (this.s = rzfh(chunk)) == 'number')
                return this.push(chunk, final);
        }
        if (typeof this.s != 'number') {
            if (ncs < (this.z || 3)) {
                if (final)
                    err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (!this.z && ncs < (this.z = (chunk[this.s.b] & 2) ? 4 : 3 + ((chunk[this.s.b] >> 3) | (chunk[this.s.b + 1] << 5) | (chunk[this.s.b + 2] << 13)))) {
                if (final)
                    err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            else
                this.z = 0;
            for (;;) {
                var blk = rzb(chunk, this.s);
                if (!blk) {
                    if (final)
                        err(5);
                    var adc = chunk.subarray(this.s.b);
                    this.s.b = 0;
                    this.c.push(adc), this.l += adc.length;
                    return;
                }
                else {
                    this.ondata(blk, false);
                    cpw(this.s.w, 0, blk.length);
                    this.s.w.set(blk, this.s.w.length - blk.length);
                }
                if (this.s.l) {
                    var rest = chunk.subarray(this.s.b);
                    this.s = this.s.c * 4;
                    this.push(rest, final);
                    return;
                }
            }
        }
        else if (final)
            err(5);
    };
    return Decompress;
}());
return { decompress, Decompress, ZstdErrorCode };
})();

// -- @gcu/bz2 (ext/bz2/index.js, inlined; see ext/bz2/LICENSE) --

const _gcuBz2 = (() => {
// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/bz2 — bzip2 in plain JavaScript, both directions: a line-for-line port of libbzip2 1.0.8, so the streams it writes are byte-identical to bzip2's (and CPython's bz2) and it reads them as libbzip2 does — streamed, with maxLength, needsInput and unusedData. No Wasm, no dependencies.

// ── src/tables.js ──

// bzip2's tables. BZ2_RNUMS is randtable.c's BZ2_rNums, copied — the randomisation of
// blocks written by bzip2 before 0.9.5 (decoders still have to undo it). The CRC is bzip2's:
// CRC-32 with the 0x04c11db7 polynomial, most significant bit first (crctable.c, computed here).

const BZ2_RNUMS = new Int32Array([
  619, 720, 127, 481, 931, 816, 813, 233, 566, 247, 985, 724, 205, 454, 863, 491,
  741, 242, 949, 214, 733, 859, 335, 708, 621, 574, 73, 654, 730, 472, 419, 436,
  278, 496, 867, 210, 399, 680, 480, 51, 878, 465, 811, 169, 869, 675, 611, 697,
  867, 561, 862, 687, 507, 283, 482, 129, 807, 591, 733, 623, 150, 238, 59, 379,
  684, 877, 625, 169, 643, 105, 170, 607, 520, 932, 727, 476, 693, 425, 174, 647,
  73, 122, 335, 530, 442, 853, 695, 249, 445, 515, 909, 545, 703, 919, 874, 474,
  882, 500, 594, 612, 641, 801, 220, 162, 819, 984, 589, 513, 495, 799, 161, 604,
  958, 533, 221, 400, 386, 867, 600, 782, 382, 596, 414, 171, 516, 375, 682, 485,
  911, 276, 98, 553, 163, 354, 666, 933, 424, 341, 533, 870, 227, 730, 475, 186,
  263, 647, 537, 686, 600, 224, 469, 68, 770, 919, 190, 373, 294, 822, 808, 206,
  184, 943, 795, 384, 383, 461, 404, 758, 839, 887, 715, 67, 618, 276, 204, 918,
  873, 777, 604, 560, 951, 160, 578, 722, 79, 804, 96, 409, 713, 940, 652, 934,
  970, 447, 318, 353, 859, 672, 112, 785, 645, 863, 803, 350, 139, 93, 354, 99,
  820, 908, 609, 772, 154, 274, 580, 184, 79, 626, 630, 742, 653, 282, 762, 623,
  680, 81, 927, 626, 789, 125, 411, 521, 938, 300, 821, 78, 343, 175, 128, 250,
  170, 774, 972, 275, 999, 639, 495, 78, 352, 126, 857, 956, 358, 619, 580, 124,
  737, 594, 701, 612, 669, 112, 134, 694, 363, 992, 809, 743, 168, 974, 944, 375,
  748, 52, 600, 747, 642, 182, 862, 81, 344, 805, 988, 739, 511, 655, 814, 334,
  249, 515, 897, 955, 664, 981, 649, 113, 974, 459, 893, 228, 433, 837, 553, 268,
  926, 240, 102, 654, 459, 51, 686, 754, 806, 760, 493, 403, 415, 394, 687, 700,
  946, 670, 656, 610, 738, 392, 760, 799, 887, 653, 978, 321, 576, 617, 626, 502,
  894, 679, 243, 440, 680, 879, 194, 572, 640, 724, 926, 56, 204, 700, 707, 151,
  457, 449, 797, 195, 791, 558, 945, 679, 297, 59, 87, 824, 713, 663, 412, 693,
  342, 606, 134, 108, 571, 364, 631, 212, 174, 643, 304, 329, 343, 97, 430, 751,
  497, 314, 983, 374, 822, 928, 140, 206, 73, 263, 980, 736, 876, 478, 430, 305,
  170, 514, 364, 692, 829, 82, 855, 953, 676, 246, 369, 970, 294, 750, 807, 827,
  150, 790, 288, 923, 804, 378, 215, 828, 592, 281, 565, 555, 710, 82, 896, 831,
  547, 261, 524, 462, 293, 465, 502, 56, 661, 821, 976, 991, 658, 869, 905, 758,
  745, 193, 768, 550, 608, 933, 378, 286, 215, 979, 792, 961, 61, 688, 793, 644,
  986, 403, 106, 366, 905, 644, 372, 567, 466, 434, 645, 210, 389, 550, 919, 135,
  780, 773, 635, 389, 707, 100, 626, 958, 165, 504, 920, 176, 193, 713, 857, 265,
  203, 50, 668, 108, 645, 990, 626, 197, 510, 357, 358, 850, 858, 364, 936, 638,
]);

const BZ2_CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

// ── src/blocksort.js ──

// The Burrows–Wheeler sort: blocksort.c of bzip2 1.0.8, ported line for line. The order it
// leaves equal rotations in decides origPtr, so a different (correct) sort would write a valid
// but different stream; this one writes libbzip2's bytes. bzip2's arrays alias one another
// (the block is the bytes of arr2, mtfv the halves of arr1); here each is its own array, which
// the C's own access pattern makes equivalent.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

const N_RADIX = 2, N_QSORT = 12, N_SHELL = 18;
const N_OVERSHOOT = N_RADIX + N_QSORT + N_SHELL + 2;

// ── fallback O(N log(N)^2) sort, for repetitive blocks ──

function fallbackSimpleSort(fmap, eclass, lo, hi) {
  let i, j, tmp, ecTmp;
  if (lo === hi) return;
  if (hi - lo > 3) {
    for (i = hi - 4; i >= lo; i--) {
      tmp = fmap[i];
      ecTmp = eclass[tmp];
      for (j = i + 4; j <= hi && ecTmp > eclass[fmap[j]]; j += 4) fmap[j - 4] = fmap[j];
      fmap[j - 4] = tmp;
    }
  }
  for (i = hi - 1; i >= lo; i--) {
    tmp = fmap[i];
    ecTmp = eclass[tmp];
    for (j = i + 1; j <= hi && ecTmp > eclass[fmap[j]]; j++) fmap[j - 1] = fmap[j];
    fmap[j - 1] = tmp;
  }
}

const FALLBACK_QSORT_SMALL_THRESH = 10;
const FALLBACK_QSORT_STACK_SIZE = 100;
const fStackLo = new Int32Array(FALLBACK_QSORT_STACK_SIZE);
const fStackHi = new Int32Array(FALLBACK_QSORT_STACK_SIZE);

function fallbackQSort3(fmap, eclass, loSt, hiSt) {
  let unLo, unHi, ltLo, gtHi, n, m, sp, lo, hi, med, r3, t;
  let r = 0;
  const stackLo = fStackLo, stackHi = fStackHi;
  sp = 0;
  stackLo[sp] = loSt; stackHi[sp] = hiSt; sp++;
  while (sp > 0) {
    if (!(sp < FALLBACK_QSORT_STACK_SIZE - 1)) throw new Error('bz2: internal error 1004');
    sp--; lo = stackLo[sp]; hi = stackHi[sp];
    if (hi - lo < FALLBACK_QSORT_SMALL_THRESH) {
      fallbackSimpleSort(fmap, eclass, lo, hi);
      continue;
    }
    // random partitioning (Sedgewick's 7621 / 32768)
    r = ((r * 7621) + 1) % 32768;
    r3 = r % 3;
    if (r3 === 0) med = eclass[fmap[lo]];
    else if (r3 === 1) med = eclass[fmap[(lo + hi) >> 1]];
    else med = eclass[fmap[hi]];

    unLo = ltLo = lo;
    unHi = gtHi = hi;
    while (true) {
      while (true) {
        if (unLo > unHi) break;
        n = eclass[fmap[unLo]] - med;
        if (n === 0) { t = fmap[unLo]; fmap[unLo] = fmap[ltLo]; fmap[ltLo] = t; ltLo++; unLo++; continue; }
        if (n > 0) break;
        unLo++;
      }
      while (true) {
        if (unLo > unHi) break;
        n = eclass[fmap[unHi]] - med;
        if (n === 0) { t = fmap[unHi]; fmap[unHi] = fmap[gtHi]; fmap[gtHi] = t; gtHi--; unHi--; continue; }
        if (n < 0) break;
        unHi--;
      }
      if (unLo > unHi) break;
      t = fmap[unLo]; fmap[unLo] = fmap[unHi]; fmap[unHi] = t; unLo++; unHi--;
    }
    if (gtHi < ltLo) continue;

    n = Math.min(ltLo - lo, unLo - ltLo); vswap(fmap, lo, unLo - n, n);
    m = Math.min(hi - gtHi, gtHi - unHi); vswap(fmap, unLo, hi - m + 1, m);
    n = lo + unLo - ltLo - 1;
    m = hi - (gtHi - unHi) + 1;
    if (n - lo > hi - m) {
      stackLo[sp] = lo; stackHi[sp] = n; sp++;
      stackLo[sp] = m; stackHi[sp] = hi; sp++;
    } else {
      stackLo[sp] = m; stackHi[sp] = hi; sp++;
      stackLo[sp] = lo; stackHi[sp] = n; sp++;
    }
  }
}

function vswap(a, p1, p2, n) {
  while (n > 0) { const t = a[p1]; a[p1] = a[p2]; a[p2] = t; p1++; p2++; n--; }
}

// fmap gets the sorted order of block[0 .. nblock-1]; eclass and bhtab are scratch
function fallbackSort(fmap, block, eclass, bhtab, nblock) {
  const ftab = new Int32Array(257);
  const ftabCopy = new Int32Array(256);
  let H, i, j, k, l, r, cc, cc1, nNotDone, nBhtab;
  const SET_BH = (zz) => { bhtab[zz >> 5] |= (1 << (zz & 31)); };
  const CLEAR_BH = (zz) => { bhtab[zz >> 5] &= ~(1 << (zz & 31)); };
  const ISSET_BH = (zz) => (bhtab[zz >> 5] & (1 << (zz & 31))) !== 0;

  // initial 1-char radix sort: the initial fmap and BH bits
  for (i = 0; i < nblock; i++) ftab[block[i]]++;
  for (i = 0; i < 256; i++) ftabCopy[i] = ftab[i];
  for (i = 1; i < 257; i++) ftab[i] += ftab[i - 1];
  for (i = 0; i < nblock; i++) {
    j = block[i];
    k = ftab[j] - 1;
    ftab[j] = k;
    fmap[k] = i;
  }
  nBhtab = 2 + ((nblock / 32) | 0);
  for (i = 0; i < nBhtab; i++) bhtab[i] = 0;
  for (i = 0; i < 256; i++) SET_BH(ftab[i]);

  // sentinel bits for block-end detection
  for (i = 0; i < 32; i++) { SET_BH(nblock + 2 * i); CLEAR_BH(nblock + 2 * i + 1); }

  // the log(N) loop: an "exponential radix sort" after Manber-Myers
  H = 1;
  while (true) {
    j = 0;
    for (i = 0; i < nblock; i++) {
      if (ISSET_BH(i)) j = i;
      k = fmap[i] - H; if (k < 0) k += nblock;
      eclass[k] = j;
    }
    nNotDone = 0;
    r = -1;
    while (true) {
      // the next non-singleton bucket
      k = r + 1;
      while (ISSET_BH(k) && (k & 0x1f)) k++;
      if (ISSET_BH(k)) {
        while (bhtab[k >> 5] === -1) k += 32;
        while (ISSET_BH(k)) k++;
      }
      l = k - 1;
      if (l >= nblock) break;
      while (!ISSET_BH(k) && (k & 0x1f)) k++;
      if (!ISSET_BH(k)) {
        while (bhtab[k >> 5] === 0) k += 32;
        while (!ISSET_BH(k)) k++;
      }
      r = k - 1;
      if (r >= nblock) break;
      // [l, r] bracket the current bucket
      if (r > l) {
        nNotDone += (r - l + 1);
        fallbackQSort3(fmap, eclass, l, r);
        // scan the bucket, generating header bits
        cc = -1;
        for (i = l; i <= r; i++) {
          cc1 = eclass[fmap[i]];
          if (cc !== cc1) { SET_BH(i); cc = cc1; }
        }
      }
    }
    H *= 2;
    if (H > nblock || nNotDone === 0) break;
  }
  // (the C reconstructs the block here, which its eclass overwrote; ours is separate)
}

// ── the main O(N^2 log(N)) sort, faster for "normal" blocks ──

// rotation i1 > rotation i2, as far as the block and the quadrant tell; budget[0] counts work
function mainGtU(i1, i2, block, quadrant, nblock, budget) {
  let k, c1, c2, s1, s2;
  for (let n = 0; n < 12; n++) {
    c1 = block[i1]; c2 = block[i2];
    if (c1 !== c2) return c1 > c2;
    i1++; i2++;
  }
  k = nblock + 8;
  do {
    for (let n = 0; n < 8; n++) {
      c1 = block[i1]; c2 = block[i2];
      if (c1 !== c2) return c1 > c2;
      s1 = quadrant[i1]; s2 = quadrant[i2];
      if (s1 !== s2) return s1 > s2;
      i1++; i2++;
    }
    if (i1 >= nblock) i1 -= nblock;
    if (i2 >= nblock) i2 -= nblock;
    k -= 8;
    budget[0]--;
  } while (k >= 0);
  return false;
}

// Knuth's increments
const INCS = [1, 4, 13, 40, 121, 364, 1093, 3280, 9841, 29524, 88573, 265720, 797161, 2391484];

function mainSimpleSort(ptr, block, quadrant, nblock, lo, hi, d, budget) {
  let i, j, h, hp, v;
  const bigN = hi - lo + 1;
  if (bigN < 2) return;
  hp = 0;
  while (INCS[hp] < bigN) hp++;
  hp--;
  for (; hp >= 0; hp--) {
    h = INCS[hp];
    i = lo + h;
    while (true) {
      // (the C unrolls three copies of this; the budget is looked at after each third)
      for (let c = 0; c < 3; c++) {
        if (i > hi) break;
        v = ptr[i];
        j = i;
        while (mainGtU(ptr[j - h] + d, v + d, block, quadrant, nblock, budget)) {
          ptr[j] = ptr[j - h];
          j = j - h;
          if (j <= (lo + h - 1)) break;
        }
        ptr[j] = v;
        i++;
      }
      if (i > hi) break;
      if (budget[0] < 0) return;
    }
  }
}

function mmed3(a, b, c) {
  let t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) {
    b = c;
    if (a > b) b = a;
  }
  return b;
}

const MAIN_QSORT_SMALL_THRESH = 20;
const MAIN_QSORT_DEPTH_THRESH = N_RADIX + N_QSORT;
const MAIN_QSORT_STACK_SIZE = 100;
const mStackLo = new Int32Array(MAIN_QSORT_STACK_SIZE);
const mStackHi = new Int32Array(MAIN_QSORT_STACK_SIZE);
const mStackD = new Int32Array(MAIN_QSORT_STACK_SIZE);

// the 3-way string quicksort of Sedgewick and Bentley
function mainQSort3(ptr, block, quadrant, nblock, loSt, hiSt, dSt, budget) {
  let unLo, unHi, ltLo, gtHi, n, m, med, sp, lo, hi, d, t;
  const stackLo = mStackLo, stackHi = mStackHi, stackD = mStackD;
  const nextLo = [0, 0, 0], nextHi = [0, 0, 0], nextD = [0, 0, 0];
  const size = (a) => nextHi[a] - nextLo[a];
  const swapNext = (a, b) => {
    let z = nextLo[a]; nextLo[a] = nextLo[b]; nextLo[b] = z;
    z = nextHi[a]; nextHi[a] = nextHi[b]; nextHi[b] = z;
    z = nextD[a]; nextD[a] = nextD[b]; nextD[b] = z;
  };

  sp = 0;
  stackLo[sp] = loSt; stackHi[sp] = hiSt; stackD[sp] = dSt; sp++;
  while (sp > 0) {
    if (!(sp < MAIN_QSORT_STACK_SIZE - 2)) throw new Error('bz2: internal error 1001');
    sp--; lo = stackLo[sp]; hi = stackHi[sp]; d = stackD[sp];
    if (hi - lo < MAIN_QSORT_SMALL_THRESH || d > MAIN_QSORT_DEPTH_THRESH) {
      mainSimpleSort(ptr, block, quadrant, nblock, lo, hi, d, budget);
      if (budget[0] < 0) return;
      continue;
    }
    med = mmed3(block[ptr[lo] + d], block[ptr[hi] + d], block[ptr[(lo + hi) >> 1] + d]);

    unLo = ltLo = lo;
    unHi = gtHi = hi;
    while (true) {
      while (true) {
        if (unLo > unHi) break;
        n = block[ptr[unLo] + d] - med;
        if (n === 0) { t = ptr[unLo]; ptr[unLo] = ptr[ltLo]; ptr[ltLo] = t; ltLo++; unLo++; continue; }
        if (n > 0) break;
        unLo++;
      }
      while (true) {
        if (unLo > unHi) break;
        n = block[ptr[unHi] + d] - med;
        if (n === 0) { t = ptr[unHi]; ptr[unHi] = ptr[gtHi]; ptr[gtHi] = t; gtHi--; unHi--; continue; }
        if (n < 0) break;
        unHi--;
      }
      if (unLo > unHi) break;
      t = ptr[unLo]; ptr[unLo] = ptr[unHi]; ptr[unHi] = t; unLo++; unHi--;
    }

    if (gtHi < ltLo) {
      stackLo[sp] = lo; stackHi[sp] = hi; stackD[sp] = d + 1; sp++;
      continue;
    }

    n = Math.min(ltLo - lo, unLo - ltLo); vswap(ptr, lo, unLo - n, n);
    m = Math.min(hi - gtHi, gtHi - unHi); vswap(ptr, unLo, hi - m + 1, m);
    n = lo + unLo - ltLo - 1;
    m = hi - (gtHi - unHi) + 1;

    nextLo[0] = lo; nextHi[0] = n; nextD[0] = d;
    nextLo[1] = m; nextHi[1] = hi; nextD[1] = d;
    nextLo[2] = n + 1; nextHi[2] = m - 1; nextD[2] = d + 1;

    if (size(0) < size(1)) swapNext(0, 1);
    if (size(1) < size(2)) swapNext(1, 2);
    if (size(0) < size(1)) swapNext(0, 1);

    for (let q = 0; q < 3; q++) { stackLo[sp] = nextLo[q]; stackHi[sp] = nextHi[q]; stackD[sp] = nextD[q]; sp++; }
  }
}

const SETMASK = 1 << 21;
const CLEARMASK = ~SETMASK;

// block holds nblock bytes plus N_OVERSHOOT of room; ptr gets the sorted order (or the sort is
// abandoned: budget[0] < 0)
function mainSort(ptr, block, quadrant, ftab, nblock, budget) {
  let i, j, k, ss, sb, c1, numQSorted, s;
  const runningOrder = new Int32Array(256);
  const bigDone = new Uint8Array(256);
  const copyStart = new Int32Array(256);
  const copyEnd = new Int32Array(256);
  const BIGFREQ = (b) => ftab[(b + 1) << 8] - ftab[b << 8];

  // the 2-byte frequency table
  for (i = 65536; i >= 0; i--) ftab[i] = 0;
  j = block[0] << 8;
  for (i = nblock - 1; i >= 0; i--) {
    quadrant[i] = 0;
    j = (j >> 8) | (block[i] << 8);
    ftab[j]++;
  }
  for (i = 0; i < N_OVERSHOOT; i++) {
    block[nblock + i] = block[i];
    quadrant[nblock + i] = 0;
  }

  // complete the initial radix sort
  for (i = 1; i <= 65536; i++) ftab[i] += ftab[i - 1];
  s = block[0] << 8;
  for (i = nblock - 1; i >= 0; i--) {
    s = ((s >> 8) | (block[i] << 8)) & 0xffff;
    j = ftab[s] - 1;
    ftab[s] = j;
    ptr[j] = i;
  }

  // the running order, from smallest to largest big bucket
  for (i = 0; i <= 255; i++) { bigDone[i] = 0; runningOrder[i] = i; }
  {
    let vv, h = 1;
    do h = 3 * h + 1; while (h <= 256);
    do {
      h = (h / 3) | 0;
      for (i = h; i <= 255; i++) {
        vv = runningOrder[i];
        j = i;
        while (BIGFREQ(runningOrder[j - h]) > BIGFREQ(vv)) {
          runningOrder[j] = runningOrder[j - h];
          j = j - h;
          if (j <= (h - 1)) break;
        }
        runningOrder[j] = vv;
      }
    } while (h !== 1);
  }

  // the main sorting loop
  numQSorted = 0;
  for (i = 0; i <= 255; i++) {
    ss = runningOrder[i];

    // Step 1: complete the big bucket [ss] by quicksorting any unsorted small buckets [ss, j]
    for (j = 0; j <= 255; j++) {
      if (j !== ss) {
        sb = (ss << 8) + j;
        if (!(ftab[sb] & SETMASK)) {
          const lo = ftab[sb] & CLEARMASK;
          const hi = (ftab[sb + 1] & CLEARMASK) - 1;
          if (hi > lo) {
            mainQSort3(ptr, block, quadrant, nblock, lo, hi, N_RADIX, budget);
            numQSorted += (hi - lo + 1);
            if (budget[0] < 0) return;
          }
        }
        ftab[sb] |= SETMASK;
      }
    }
    if (bigDone[ss]) throw new Error('bz2: internal error 1006');

    // Step 2: scan the big bucket [ss] to synthesise the order of the small buckets [t, ss]
    for (j = 0; j <= 255; j++) {
      copyStart[j] = ftab[(j << 8) + ss] & CLEARMASK;
      copyEnd[j] = (ftab[(j << 8) + ss + 1] & CLEARMASK) - 1;
    }
    for (j = ftab[ss << 8] & CLEARMASK; j < copyStart[ss]; j++) {
      k = ptr[j] - 1; if (k < 0) k += nblock;
      c1 = block[k];
      if (!bigDone[c1]) ptr[copyStart[c1]++] = k;
    }
    for (j = (ftab[(ss + 1) << 8] & CLEARMASK) - 1; j > copyEnd[ss]; j--) {
      k = ptr[j] - 1; if (k < 0) k += nblock;
      c1 = block[k];
      if (!bigDone[c1]) ptr[copyEnd[c1]--] = k;
    }
    if (!((copyStart[ss] - 1 === copyEnd[ss]) || (copyStart[ss] === 0 && copyEnd[ss] === nblock - 1))) {
      throw new Error('bz2: internal error 1007');
    }
    for (j = 0; j <= 255; j++) ftab[(j << 8) + ss] |= SETMASK;

    // Step 3: [ss] is done; record that, and update the quadrant descriptors
    bigDone[ss] = 1;
    if (i < 255) {
      const bbStart = ftab[ss << 8] & CLEARMASK;
      const bbSize = (ftab[(ss + 1) << 8] & CLEARMASK) - bbStart;
      let shifts = 0;
      while ((bbSize >> shifts) > 65534) shifts++;
      for (j = bbSize - 1; j >= 0; j--) {
        const a2update = ptr[bbStart + j];
        const qVal = (j >> shifts) & 0xffff;
        quadrant[a2update] = qVal;
        if (a2update < N_OVERSHOOT) quadrant[a2update + nblock] = qVal;
      }
      if (!(((bbSize - 1) >> shifts) <= 65535)) throw new Error('bz2: internal error 1002');
    }
  }
}

// BZ2_blockSort: s = { ptr, block, quadrant, ftab, eclass, nblock, workFactor } → origPtr
function blockSort(s) {
  const { ptr, block, quadrant, ftab, nblock } = s;
  if (nblock < 10000) {
    fallbackSort(ptr, block, s.eclass, ftab, nblock);
  } else {
    let wfact = s.workFactor;
    if (wfact < 1) wfact = 1;
    if (wfact > 100) wfact = 100;
    const budget = [nblock * (((wfact - 1) / 3) | 0)];
    mainSort(ptr, block, quadrant, ftab, nblock, budget);
    if (budget[0] < 0) fallbackSort(ptr, block, s.eclass, ftab, nblock);
  }
  for (let i = 0; i < nblock; i++) if (ptr[i] === 0) return i;
  throw new Error('bz2: internal error 1003');
}

// ── src/huffman.js ──

// Huffman code lengths and canonical codes: huffman.c of bzip2 1.0.8, ported line for line
// (the tie-breaking of its heap decides the lengths, hence the stream's bytes).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

const MAX_ALPHA_SIZE = 258;
const MAX_CODE_LEN = 23;

const heap = new Int32Array(MAX_ALPHA_SIZE + 2);
const weight = new Int32Array(MAX_ALPHA_SIZE * 2);
const parent = new Int32Array(MAX_ALPHA_SIZE * 2);

// len[0 .. alphaSize-1] ← code lengths for freq, none longer than maxLen
function makeCodeLengths(len, freq, alphaSize, maxLen) {
  let nNodes, nHeap, n1, n2, i, j, k, tooLong;
  const upheap = (z) => {
    let zz = z;
    const tmp = heap[zz];
    while (weight[tmp] < weight[heap[zz >> 1]]) {
      heap[zz] = heap[zz >> 1];
      zz >>= 1;
    }
    heap[zz] = tmp;
  };
  const downheap = (z) => {
    let zz = z, yy;
    const tmp = heap[zz];
    while (true) {
      yy = zz << 1;
      if (yy > nHeap) break;
      if (yy < nHeap && weight[heap[yy + 1]] < weight[heap[yy]]) yy++;
      if (weight[tmp] < weight[heap[yy]]) break;
      heap[zz] = heap[yy];
      zz = yy;
    }
    heap[zz] = tmp;
  };

  for (i = 0; i < alphaSize; i++) weight[i + 1] = (freq[i] === 0 ? 1 : freq[i]) << 8;

  while (true) {
    nNodes = alphaSize;
    nHeap = 0;
    heap[0] = 0;
    weight[0] = 0;
    parent[0] = -2;
    for (i = 1; i <= alphaSize; i++) {
      parent[i] = -1;
      nHeap++;
      heap[nHeap] = i;
      upheap(nHeap);
    }
    while (nHeap > 1) {
      n1 = heap[1]; heap[1] = heap[nHeap]; nHeap--; downheap(1);
      n2 = heap[1]; heap[1] = heap[nHeap]; nHeap--; downheap(1);
      nNodes++;
      parent[n1] = parent[n2] = nNodes;
      // ADDWEIGHTS: the weights add, the depth is one more than the deeper's
      const w1 = weight[n1], w2 = weight[n2];
      weight[nNodes] = ((w1 & 0xffffff00) + (w2 & 0xffffff00)) | (1 + Math.max(w1 & 0xff, w2 & 0xff));
      parent[nNodes] = -1;
      nHeap++;
      heap[nHeap] = nNodes;
      upheap(nHeap);
    }

    tooLong = false;
    for (i = 1; i <= alphaSize; i++) {
      j = 0;
      k = i;
      while (parent[k] >= 0) { k = parent[k]; j++; }
      len[i - 1] = j;
      if (j > maxLen) tooLong = true;
    }
    if (!tooLong) break;

    // too long: flatten the frequencies and go again
    for (i = 1; i <= alphaSize; i++) {
      j = weight[i] >> 8;
      j = 1 + ((j / 2) | 0);
      weight[i] = j << 8;
    }
  }
}

function assignCodes(code, length, minLen, maxLen, alphaSize) {
  let vec = 0;
  for (let n = minLen; n <= maxLen; n++) {
    for (let i = 0; i < alphaSize; i++) if (length[i] === n) { code[i] = vec; vec++; }
    vec <<= 1;
  }
}

function createDecodeTables(limit, base, perm, length, minLen, maxLen, alphaSize) {
  let pp = 0, i, j, vec;
  for (i = minLen; i <= maxLen; i++) {
    for (j = 0; j < alphaSize; j++) if (length[j] === i) { perm[pp] = j; pp++; }
  }
  for (i = 0; i < MAX_CODE_LEN; i++) base[i] = 0;
  for (i = 0; i < alphaSize; i++) base[length[i] + 1]++;
  for (i = 1; i < MAX_CODE_LEN; i++) base[i] += base[i - 1];
  for (i = 0; i < MAX_CODE_LEN; i++) limit[i] = 0;
  vec = 0;
  for (i = minLen; i <= maxLen; i++) {
    vec += (base[i + 1] - base[i]);
    limit[i] = vec - 1;
    vec <<= 1;
  }
  for (i = minLen + 1; i <= maxLen; i++) base[i] = ((limit[i - 1] + 1) << 1) - base[i];
}

// ── src/compress.js ──

// The bzip2 compressor: bzlib.c's input side (the initial run-length coding into blocks) and
// compress.c (MTF + run coding, Huffman table selection, the bit stream), bzip2 1.0.8 ported
// line for line — so the bytes are libbzip2's, down to where a compress() call's output ends
// (its bit writer empties only before a write, so up to three whole bytes wait for the next).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.


const RUNA$compress = 0, RUNB$compress = 1;
const N_GROUPS$compress = 6, G_SIZE$compress = 50, N_ITERS = 4;
const MAX_SELECTORS$compress = 2 + ((900000 / G_SIZE$compress) | 0);
const LESSER_ICOST = 0, GREATER_ICOST = 15;

class Compressor {
  // blockSize100k 1..9 (the compresslevel); workFactor 0..250 (0 = the default, 30)
  constructor(blockSize100k = 9, workFactor = 0) {
    if (!(Number.isInteger(blockSize100k) && blockSize100k >= 1 && blockSize100k <= 9)) {
      throw new RangeError('bz2: compresslevel must be between 1 and 9');
    }
    if (!(Number.isInteger(workFactor) && workFactor >= 0 && workFactor <= 250)) {
      throw new RangeError('bz2: workFactor must be between 0 and 250');
    }
    const n = 100000 * blockSize100k;
    this.blockSize100k = blockSize100k;
    this.workFactor = workFactor === 0 ? 30 : workFactor;
    this.nblockMAX = n - 19;
    this.block = new Uint8Array(n + N_OVERSHOOT);
    this.quadrant = new Uint16Array(n + N_OVERSHOOT);
    this.ptr = new Int32Array(n);
    this.eclass = new Int32Array(n);
    this.ftab = new Int32Array(65537);
    this.mtfv = new Uint16Array(n + 1);
    this.inUse = new Uint8Array(256);
    this.unseqToSeq = new Uint8Array(256);
    this.mtfFreq = new Int32Array(MAX_ALPHA_SIZE);
    this.len = Array.from({ length: N_GROUPS$compress }, () => new Uint8Array(MAX_ALPHA_SIZE));
    this.code = Array.from({ length: N_GROUPS$compress }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.rfreq = Array.from({ length: N_GROUPS$compress }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.selector = new Uint8Array(MAX_SELECTORS$compress);
    this.selectorMtf = new Uint8Array(MAX_SELECTORS$compress);
    // the output: whole bytes, and the bits not yet a byte
    this.out = new Uint8Array(1024);
    this.numZ = 0;
    this.bsBuff = 0;
    this.bsLive = 0;
    this.blockNo = 0;
    this.combinedCRC = 0;
    this.finished = false;
    // the run being coded (init_RL): no char yet
    this.stateInCh = 256;
    this.stateInLen = 0;
    this._prepareNewBlock();
  }

  // feed bytes (BZ_RUN); returns the stream bytes completed so far
  compress(data) {
    if (this.finished) throw new Error('bz2: compressor already finished');
    for (let i = 0; i < data.length; i++) {
      this._addChar(data[i]);
      if (this.nblock >= this.nblockMAX) {
        this._compressBlock(false);
        this._prepareNewBlock();
      }
    }
    return this._take();
  }

  // the end of the stream (BZ_FINISH): the last block, the trailer, the last bits
  flush() {
    if (this.finished) throw new Error('bz2: compressor already finished');
    this.finished = true;
    this._flushRL();
    this._compressBlock(true);
    return this._take();
  }

  _take() {
    const r = this.out.slice(0, this.numZ);
    this.numZ = 0;
    return r;
  }

  _prepareNewBlock() {
    this.nblock = 0;
    this.blockCRC = 0xffffffff;
    this.inUse.fill(0);
    this.blockNo++;
  }

  // ADD_CHAR_TO_BLOCK
  _addChar(ch) {
    if (ch !== this.stateInCh && this.stateInLen === 1) {
      const c = this.stateInCh;
      this.blockCRC = ((this.blockCRC << 8) ^ BZ2_CRC32_TABLE[(this.blockCRC >>> 24) ^ c]) >>> 0;
      this.inUse[c] = 1;
      this.block[this.nblock++] = c;
      this.stateInCh = ch;
    } else if (ch !== this.stateInCh || this.stateInLen === 255) {
      if (this.stateInCh < 256) this._addPairToBlock();
      this.stateInCh = ch;
      this.stateInLen = 1;
    } else {
      this.stateInLen++;
    }
  }

  _addPairToBlock() {
    const ch = this.stateInCh, n = this.stateInLen, block = this.block;
    let crc = this.blockCRC;
    for (let i = 0; i < n; i++) crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
    this.blockCRC = crc;
    this.inUse[ch] = 1;
    if (n <= 3) {
      for (let i = 0; i < n; i++) block[this.nblock++] = ch;
    } else {
      this.inUse[n - 4] = 1;
      for (let i = 0; i < 4; i++) block[this.nblock++] = ch;
      block[this.nblock++] = n - 4;
    }
  }

  _flushRL() {
    if (this.stateInCh < 256) this._addPairToBlock();
    this.stateInCh = 256;
    this.stateInLen = 0;
  }

  // ── the bit stream (bsW: empty whole bytes first, then add n bits of v) ──

  _bsW(n, v) {
    while (this.bsLive >= 8) {
      if (this.numZ === this.out.length) {
        const o = new Uint8Array(this.out.length * 2);
        o.set(this.out);
        this.out = o;
      }
      this.out[this.numZ++] = this.bsBuff >>> 24;
      this.bsBuff = (this.bsBuff << 8) >>> 0;
      this.bsLive -= 8;
    }
    this.bsBuff = (this.bsBuff | (v << (32 - this.bsLive - n))) >>> 0;
    this.bsLive += n;
  }

  _bsPutUInt32(u) {
    this._bsW(8, (u >>> 24) & 0xff);
    this._bsW(8, (u >>> 16) & 0xff);
    this._bsW(8, (u >>> 8) & 0xff);
    this._bsW(8, u & 0xff);
  }

  _bsFinishWrite() {
    while (this.bsLive > 0) {
      if (this.numZ === this.out.length) {
        const o = new Uint8Array(this.out.length * 2);
        o.set(this.out);
        this.out = o;
      }
      this.out[this.numZ++] = this.bsBuff >>> 24;
      this.bsBuff = (this.bsBuff << 8) >>> 0;
      this.bsLive -= 8;
    }
  }

  // BZ2_compressBlock
  _compressBlock(isLastBlock) {
    if (this.nblock > 0) {
      this.blockCRC = (~this.blockCRC) >>> 0;
      this.combinedCRC = (((this.combinedCRC << 1) | (this.combinedCRC >>> 31)) ^ this.blockCRC) >>> 0;
      this.origPtr = blockSort(this);
    }
    if (this.blockNo === 1) {
      this._bsW(8, 0x42); this._bsW(8, 0x5a); this._bsW(8, 0x68);   // 'BZh'
      this._bsW(8, 0x30 + this.blockSize100k);
    }
    if (this.nblock > 0) {
      this._bsW(8, 0x31); this._bsW(8, 0x41); this._bsW(8, 0x59);
      this._bsW(8, 0x26); this._bsW(8, 0x53); this._bsW(8, 0x59);
      this._bsPutUInt32(this.blockCRC);
      this._bsW(1, 0);   // not randomised
      this._bsW(24, this.origPtr);
      this._generateMTFValues();
      this._sendMTFValues();
    }
    if (isLastBlock) {
      this._bsW(8, 0x17); this._bsW(8, 0x72); this._bsW(8, 0x45);
      this._bsW(8, 0x38); this._bsW(8, 0x50); this._bsW(8, 0x90);
      this._bsPutUInt32(this.combinedCRC);
      this._bsFinishWrite();
    }
  }

  _generateMTFValues() {
    const yy = new Uint8Array(256);
    const { ptr, block, mtfv, mtfFreq, unseqToSeq } = this;
    const nblock = this.nblock;
    let i, j, zPend, wr;

    // makeMaps_e
    let nInUse = 0;
    for (i = 0; i < 256; i++) if (this.inUse[i]) unseqToSeq[i] = nInUse++;
    this.nInUse = nInUse;
    const EOB = nInUse + 1;
    for (i = 0; i <= EOB; i++) mtfFreq[i] = 0;

    wr = 0;
    zPend = 0;
    for (i = 0; i < nInUse; i++) yy[i] = i;

    const putRun = () => {
      zPend--;
      while (true) {
        if (zPend & 1) { mtfv[wr++] = RUNB$compress; mtfFreq[RUNB$compress]++; } else { mtfv[wr++] = RUNA$compress; mtfFreq[RUNA$compress]++; }
        if (zPend < 2) break;
        zPend = ((zPend - 2) / 2) | 0;
      }
      zPend = 0;
    };

    for (i = 0; i < nblock; i++) {
      j = ptr[i] - 1; if (j < 0) j += nblock;
      const llI = unseqToSeq[block[j]];
      if (yy[0] === llI) {
        zPend++;
      } else {
        if (zPend > 0) putRun();
        // move llI to the front; j its old position
        let rtmp = yy[1];
        yy[1] = yy[0];
        let p = 1;
        while (llI !== rtmp) {
          p++;
          const rtmp2 = rtmp;
          rtmp = yy[p];
          yy[p] = rtmp2;
        }
        yy[0] = rtmp;
        mtfv[wr++] = p + 1;
        mtfFreq[p + 1]++;
      }
    }
    if (zPend > 0) putRun();
    mtfv[wr++] = EOB;
    mtfFreq[EOB]++;
    this.nMTF = wr;
  }

  _sendMTFValues() {
    const { mtfv, len, code, rfreq, selector, selectorMtf } = this;
    const nMTF = this.nMTF;
    const alphaSize = this.nInUse + 2;
    const cost = new Uint16Array(N_GROUPS$compress);
    const fave = new Int32Array(N_GROUPS$compress);
    let v, t, i, j, gs, ge, bt, bc, iter, nSelectors, nGroups, minLen, maxLen, selCtr;

    for (t = 0; t < N_GROUPS$compress; t++) for (v = 0; v < alphaSize; v++) len[t][v] = GREATER_ICOST;

    // how many coding tables
    if (!(nMTF > 0)) throw new Error('bz2: internal error 3001');
    if (nMTF < 200) nGroups = 2;
    else if (nMTF < 600) nGroups = 3;
    else if (nMTF < 1200) nGroups = 4;
    else if (nMTF < 2400) nGroups = 5;
    else nGroups = 6;

    // an initial set of coding tables
    {
      let nPart = nGroups, remF = nMTF, tFreq, aFreq;
      gs = 0;
      while (nPart > 0) {
        tFreq = (remF / nPart) | 0;
        ge = gs - 1;
        aFreq = 0;
        while (aFreq < tFreq && ge < alphaSize - 1) {
          ge++;
          aFreq += this.mtfFreq[ge];
        }
        if (ge > gs && nPart !== nGroups && nPart !== 1 && ((nGroups - nPart) % 2 === 1)) {
          aFreq -= this.mtfFreq[ge];
          ge--;
        }
        for (v = 0; v < alphaSize; v++) len[nPart - 1][v] = (v >= gs && v <= ge) ? LESSER_ICOST : GREATER_ICOST;
        nPart--;
        gs = ge + 1;
        remF -= aFreq;
      }
    }

    // up to N_ITERS passes improving the tables
    for (iter = 0; iter < N_ITERS; iter++) {
      for (t = 0; t < nGroups; t++) fave[t] = 0;
      for (t = 0; t < nGroups; t++) for (v = 0; v < alphaSize; v++) rfreq[t][v] = 0;
      nSelectors = 0;
      gs = 0;
      while (true) {
        if (gs >= nMTF) break;
        ge = gs + G_SIZE$compress - 1;
        if (ge >= nMTF) ge = nMTF - 1;
        // this group's cost under each table (the C's 6-table fast path computes the same)
        for (t = 0; t < nGroups; t++) cost[t] = 0;
        for (i = gs; i <= ge; i++) {
          const icv = mtfv[i];
          for (t = 0; t < nGroups; t++) cost[t] += len[t][icv];
        }
        // the cheapest table: this group's selector
        bc = 999999999; bt = -1;
        for (t = 0; t < nGroups; t++) if (cost[t] < bc) { bc = cost[t]; bt = t; }
        fave[bt]++;
        selector[nSelectors++] = bt;
        for (i = gs; i <= ge; i++) rfreq[bt][mtfv[i]]++;
        gs = ge + 1;
      }
      // recompute the tables from what each was chosen for (maxLen 17, since bzip2 1.0.3)
      for (t = 0; t < nGroups; t++) makeCodeLengths(len[t], rfreq[t], alphaSize, 17);
    }
    if (!(nSelectors < 32768 && nSelectors <= MAX_SELECTORS$compress)) throw new Error('bz2: internal error 3003');

    // MTF values for the selectors
    {
      const pos = new Uint8Array(N_GROUPS$compress);
      for (i = 0; i < nGroups; i++) pos[i] = i;
      for (i = 0; i < nSelectors; i++) {
        const llI = selector[i];
        j = 0;
        let tmp = pos[j];
        while (llI !== tmp) {
          j++;
          const tmp2 = tmp;
          tmp = pos[j];
          pos[j] = tmp2;
        }
        pos[0] = tmp;
        selectorMtf[i] = j;
      }
    }

    // the actual codes
    for (t = 0; t < nGroups; t++) {
      minLen = 32;
      maxLen = 0;
      for (i = 0; i < alphaSize; i++) {
        if (len[t][i] > maxLen) maxLen = len[t][i];
        if (len[t][i] < minLen) minLen = len[t][i];
      }
      if (maxLen > 17 || minLen < 1) throw new Error('bz2: internal error 3004');
      assignCodes(code[t], len[t], minLen, maxLen, alphaSize);
    }

    // the mapping table
    {
      const inUse16 = new Uint8Array(16);
      for (i = 0; i < 16; i++) for (j = 0; j < 16; j++) if (this.inUse[i * 16 + j]) inUse16[i] = 1;
      for (i = 0; i < 16; i++) this._bsW(1, inUse16[i]);
      for (i = 0; i < 16; i++) {
        if (inUse16[i]) for (j = 0; j < 16; j++) this._bsW(1, this.inUse[i * 16 + j]);
      }
    }

    // the selectors
    this._bsW(3, nGroups);
    this._bsW(15, nSelectors);
    for (i = 0; i < nSelectors; i++) {
      for (j = 0; j < selectorMtf[i]; j++) this._bsW(1, 1);
      this._bsW(1, 0);
    }

    // the coding tables, as deltas
    for (t = 0; t < nGroups; t++) {
      let curr = len[t][0];
      this._bsW(5, curr);
      for (i = 0; i < alphaSize; i++) {
        while (curr < len[t][i]) { this._bsW(2, 2); curr++; }
        while (curr > len[t][i]) { this._bsW(2, 3); curr--; }
        this._bsW(1, 0);
      }
    }

    // and the block data proper
    selCtr = 0;
    gs = 0;
    while (true) {
      if (gs >= nMTF) break;
      ge = gs + G_SIZE$compress - 1;
      if (ge >= nMTF) ge = nMTF - 1;
      const sl = len[selector[selCtr]], sc = code[selector[selCtr]];
      for (i = gs; i <= ge; i++) this._bsW(sl[mtfv[i]], sc[mtfv[i]]);
      gs = ge + 1;
      selCtr++;
    }
  }
}

// ── src/decompress.js ──

// The bzip2 decompressor: decompress.c (one block's Huffman / MTF / run decoding, then the
// inverse BWT) and bzlib.c's output side (the run-length decoding, CRCs), bzip2 1.0.8 ported.
// Input is consumed as libbzip2 consumes it — a byte at a time, only when bits are needed — so
// what's left over (unusedData) and when more input is wanted (needsInput) are libbzip2's, and
// so CPython's. The block parser is a generator: it pauses wherever the input runs out, the
// C's save-and-return-by-state machinery in another form.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.


const RUNA$decompress = 0, RUNB$decompress = 1;
const N_GROUPS$decompress = 6, G_SIZE$decompress = 50;
const MAX_SELECTORS$decompress = 2 + ((900000 / G_SIZE$decompress) | 0);

// libbzip2's BZ_DATA_ERROR / BZ_DATA_ERROR_MAGIC
class BzDataError extends Error {
  constructor(magic = false) {
    super(magic ? 'bz2: not a bzip2 stream' : 'bz2: invalid data stream');
    this.name = 'BzDataError';
    this.magic = magic;
  }
}

const NEED_INPUT = 1, BLOCK_READY = 2, STREAM_END = 3;

class Decompressor {
  constructor() {
    this.eof = false;
    this.needsInput = true;
    this.unusedData = new Uint8Array(0);
    this._in = new Uint8Array(0);   // input not yet consumed
    this._pos = 0;
    this._parser = this._parse();
    this._state = 'parse';          // 'parse' | 'output'
    this._calculatedCombinedCRC = 0;
    this._storedCombinedCRC = 0;
    this._broken = null;
  }

  // CPython's BZ2Decompressor.decompress: everything the input decodes to, or at most maxLength
  // bytes of it (maxLength < 0: no limit); input it hasn't reached yet is kept for later
  decompress(data, maxLength = -1) {
    if (this.eof) throw new Error('bz2: end of stream already reached');
    if (this._broken) throw this._broken;
    // the unconsumed input, then the new
    if (this._pos < this._in.length) {
      const rest = this._in.subarray(this._pos);
      const b = new Uint8Array(rest.length + data.length);
      b.set(rest); b.set(data, rest.length);
      this._in = b;
    } else {
      this._in = data instanceof Uint8Array ? data : Uint8Array.from(data);
    }
    this._pos = 0;

    const out = new _Out(maxLength);
    try {
      // BZ2_bzDecompress, called until the stream ends, the input is used up, or the output is full
      while (true) {
        if (this._state === 'output') {
          if (this._unRLE(out)) throw new BzDataError();
          if (this._nblockUsed === this._nblock + 1 && this._stateOutLen === 0) {
            this._blockCRC = (~this._blockCRC) >>> 0;
            if (this._blockCRC !== this._storedBlockCRC) throw new BzDataError();
            this._calculatedCombinedCRC = (((this._calculatedCombinedCRC << 1) | (this._calculatedCombinedCRC >>> 31)) ^ this._blockCRC) >>> 0;
            this._state = 'parse';
          } else if (!out.full()) {
            continue;   // (out grew: more room)
          } else {
            break;      // the output is at maxLength
          }
        }
        const r = this._parser.next().value;
        if (r === STREAM_END) {
          if (this._calculatedCombinedCRC !== this._storedCombinedCRC) throw new BzDataError();
          this.eof = true;
          break;
        }
        if (r === NEED_INPUT) break;
        this._state = 'output';   // BLOCK_READY
      }
    } catch (e) {
      this._broken = e;
      throw e;
    }

    const avail = this._in.length - this._pos;
    if (this.eof) {
      this.needsInput = false;
      if (avail > 0) this.unusedData = this._in.slice(this._pos);
    } else {
      this.needsInput = avail === 0;
    }
    return out.result();
  }

  // ── the block parser (BZ2_decompress) ──
  // yields NEED_INPUT when it runs out of bytes (resumed with more in this._in from _pos), and
  // BLOCK_READY when a block is decoded into tt; returns STREAM_END after the trailer
  *_parse() {
    let bsBuff = 0, bsLive = 0;
    let input = this._in, inPos = this._pos;
    // GET_BITS, inline where it's hot; this is the general form
    const self = this;
    let v;

    // (each `while (bsLive < n)` below is GET_BITS: pull bytes, pausing for more input)
    // stream header
    for (const want of [0x42, 0x5a, 0x68]) {
      while (bsLive < 8) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      v = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
      if (v !== want) { self._pos = inPos; throw new BzDataError(true); }
    }
    while (bsLive < 8) {
      if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
      bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
    }
    let blockSize100k = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
    if (blockSize100k < 0x31 || blockSize100k > 0x39) { self._pos = inPos; throw new BzDataError(true); }
    blockSize100k -= 0x30;
    this._blockSize100k = blockSize100k;
    const tt = new Uint32Array(blockSize100k * 100000);
    this._tt = tt;

    const inUse16 = new Uint8Array(16), inUse = new Uint8Array(256), seqToUnseq = new Uint8Array(256);
    const selectorMtf = new Uint8Array(MAX_SELECTORS$decompress), selector = new Uint8Array(MAX_SELECTORS$decompress);
    const len = Array.from({ length: N_GROUPS$decompress }, () => new Uint8Array(MAX_ALPHA_SIZE));
    const limit = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_CODE_LEN));
    const base = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_CODE_LEN));
    const perm = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_ALPHA_SIZE));
    const minLens = new Int32Array(N_GROUPS$decompress);
    const unzftab = new Int32Array(256), cftab = new Int32Array(257);
    const mtf = new Uint8Array(256);

    while (true) {
      // a block header (0x314159265359) or the stream trailer (0x177245385090)
      const magic = [];
      for (let b = 0; b < 6; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        v = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
        magic.push(v);
        const want = (b === 0 ? (v === 0x17 ? TRAILER : BLOCK) : magic[0] === 0x17 ? TRAILER : BLOCK)[b];
        if (v !== want) { self._pos = inPos; throw new BzDataError(); }
      }
      // the CRC that follows either
      let crc = 0;
      for (let b = 0; b < 4; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        crc = ((crc << 8) | ((bsBuff >>> (bsLive - 8)) & 0xff)) >>> 0; bsLive -= 8;
      }
      if (magic[0] === 0x17) {
        this._storedCombinedCRC = crc;
        self._pos = inPos;
        return STREAM_END;
      }
      this._storedBlockCRC = crc;

      // randomised?, origPtr
      while (bsLive < 1) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      const blockRandomised = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
      let origPtr = 0;
      for (let b = 0; b < 3; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        origPtr = (origPtr << 8) | ((bsBuff >>> (bsLive - 8)) & 0xff); bsLive -= 8;
      }
      if (origPtr > 10 + 100000 * blockSize100k) { self._pos = inPos; throw new BzDataError(); }

      // the mapping table
      for (let i = 0; i < 16; i++) {
        while (bsLive < 1) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        inUse16[i] = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
      }
      inUse.fill(0);
      for (let i = 0; i < 16; i++) {
        if (!inUse16[i]) continue;
        for (let j = 0; j < 16; j++) {
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          if ((bsBuff >>> (bsLive - 1)) & 1) inUse[i * 16 + j] = 1;
          bsLive -= 1;
        }
      }
      let nInUse = 0;
      for (let i = 0; i < 256; i++) if (inUse[i]) seqToUnseq[nInUse++] = i;
      if (nInUse === 0) { self._pos = inPos; throw new BzDataError(); }
      const alphaSize = nInUse + 2;

      // the selectors
      while (bsLive < 3) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      const nGroups = (bsBuff >>> (bsLive - 3)) & 7; bsLive -= 3;
      if (nGroups < 2 || nGroups > N_GROUPS$decompress) { self._pos = inPos; throw new BzDataError(); }
      while (bsLive < 15) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      let nSelectors = (bsBuff >>> (bsLive - 15)) & 0x7fff; bsLive -= 15;
      if (nSelectors < 1) { self._pos = inPos; throw new BzDataError(); }
      for (let i = 0; i < nSelectors; i++) {
        let j = 0;
        while (true) {
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          const bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
          if (bit === 0) break;
          j++;
          if (j >= nGroups) { self._pos = inPos; throw new BzDataError(); }
        }
        // (more than MAX_SELECTORS can't be used, but some writers round up: ignore them)
        if (i < MAX_SELECTORS$decompress) selectorMtf[i] = j;
      }
      if (nSelectors > MAX_SELECTORS$decompress) nSelectors = MAX_SELECTORS$decompress;
      {
        const pos = new Uint8Array(N_GROUPS$decompress);
        for (let q = 0; q < nGroups; q++) pos[q] = q;
        for (let i = 0; i < nSelectors; i++) {
          let q = selectorMtf[i];
          const tmp = pos[q];
          while (q > 0) { pos[q] = pos[q - 1]; q--; }
          pos[0] = tmp;
          selector[i] = tmp;
        }
      }

      // the coding tables
      for (let t = 0; t < nGroups; t++) {
        while (bsLive < 5) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        let curr = (bsBuff >>> (bsLive - 5)) & 0x1f; bsLive -= 5;
        for (let i = 0; i < alphaSize; i++) {
          while (true) {
            if (curr < 1 || curr > 20) { self._pos = inPos; throw new BzDataError(); }
            while (bsLive < 1) {
              if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
              bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
            }
            let bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
            if (bit === 0) break;
            while (bsLive < 1) {
              if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
              bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
            }
            bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
            if (bit === 0) curr++; else curr--;
          }
          len[t][i] = curr;
        }
      }
      for (let t = 0; t < nGroups; t++) {
        let minLen = 32, maxLen = 0;
        for (let i = 0; i < alphaSize; i++) {
          if (len[t][i] > maxLen) maxLen = len[t][i];
          if (len[t][i] < minLen) minLen = len[t][i];
        }
        createDecodeTables(limit[t], base[t], perm[t], len[t], minLen, maxLen, alphaSize);
        minLens[t] = minLen;
      }

      // the MTF values
      const EOB = nInUse + 1;
      const nblockMAX = 100000 * blockSize100k;
      let groupNo = -1, groupPos = 0;
      let gSel = 0, gMinlen = 0, gLimit = null, gBase = null, gPerm = null;
      unzftab.fill(0);
      for (let i = 0; i < 256; i++) mtf[i] = i;
      let nblock = 0;
      let nextSym;

      // GET_MTF_VAL, written out at its three uses
      while (true) {
        if (groupPos === 0) {
          groupNo++;
          if (groupNo >= nSelectors) { self._pos = inPos; throw new BzDataError(); }
          groupPos = G_SIZE$decompress;
          gSel = selector[groupNo];
          gMinlen = minLens[gSel]; gLimit = limit[gSel]; gPerm = perm[gSel]; gBase = base[gSel];
        }
        groupPos--;
        let zn = gMinlen;
        while (bsLive < zn) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        let zvec = (bsBuff >>> (bsLive - zn)) & ((1 << zn) - 1); bsLive -= zn;
        while (true) {
          if (zn > 20) { self._pos = inPos; throw new BzDataError(); }
          if (zvec <= gLimit[zn]) break;
          zn++;
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          zvec = (zvec << 1) | ((bsBuff >>> (bsLive - 1)) & 1); bsLive -= 1;
        }
        if (zvec - gBase[zn] < 0 || zvec - gBase[zn] >= MAX_ALPHA_SIZE) { self._pos = inPos; throw new BzDataError(); }
        nextSym = gPerm[zvec - gBase[zn]];

        if (nextSym === EOB) break;
        if (nextSym === RUNA$decompress || nextSym === RUNB$decompress) {
          // a run of the front symbol: RUNA / RUNB digits, bijective base 2
          if (this._runN === undefined) { this._runEs = -1; this._runN = 1; }
          if (this._runN >= 2 * 1024 * 1024) { self._pos = inPos; throw new BzDataError(); }
          this._runEs += (nextSym === RUNA$decompress ? 1 : 2) * this._runN;
          this._runN *= 2;
          continue;
        }
        if (this._runN !== undefined) {
          nblock = this._flushRun(nblock, nblockMAX, seqToUnseq[mtf[0]], unzftab, tt, inPos);
        }
        if (nblock >= nblockMAX) { self._pos = inPos; throw new BzDataError(); }
        // uc = MTF(nextSym - 1)
        const nn = nextSym - 1;
        const uc = mtf[nn];
        mtf.copyWithin(1, 0, nn);
        mtf[0] = uc;
        const b = seqToUnseq[uc];
        unzftab[b]++;
        tt[nblock++] = b;
      }
      if (this._runN !== undefined) {
        nblock = this._flushRun(nblock, nblockMAX, seqToUnseq[mtf[0]], unzftab, tt, inPos);
      }

      // now nblock is known: a better check of origPtr
      if (origPtr < 0 || origPtr >= nblock) { self._pos = inPos; throw new BzDataError(); }
      for (let i = 0; i <= 255; i++) {
        if (unzftab[i] < 0 || unzftab[i] > nblock) { self._pos = inPos; throw new BzDataError(); }
      }
      cftab[0] = 0;
      for (let i = 1; i <= 256; i++) cftab[i] = unzftab[i - 1];
      for (let i = 1; i <= 256; i++) cftab[i] += cftab[i - 1];
      for (let i = 0; i <= 256; i++) {
        if (cftab[i] < 0 || cftab[i] > nblock) { self._pos = inPos; throw new BzDataError(); }
      }
      for (let i = 1; i <= 256; i++) {
        if (cftab[i - 1] > cftab[i]) { self._pos = inPos; throw new BzDataError(); }
      }

      // T^(-1), in the high 24 bits of tt beside each byte
      for (let i = 0; i < nblock; i++) {
        const uc = tt[i] & 0xff;
        tt[cftab[uc]] |= (i << 8);
        cftab[uc]++;
      }
      this._stateOutLen = 0;
      this._stateOutCh = 0;
      this._blockCRC = 0xffffffff;
      this._nblock = nblock;
      this._tPos = tt[origPtr] >>> 8;
      this._nblockUsed = 0;
      this._randomised = blockRandomised;
      if (blockRandomised) {
        this._rNToGo = 0; this._rTPos = 0;
        if (this._getFast()) { self._pos = inPos; throw new BzDataError(); }
        this._k0 = this._got; this._nblockUsed++;
        this._randUpd(); this._k0 ^= this._randMask();
      } else {
        if (this._getFast()) { self._pos = inPos; throw new BzDataError(); }
        this._k0 = this._got; this._nblockUsed++;
      }
      self._pos = inPos;
      yield BLOCK_READY;
      input = self._in; inPos = self._pos;
    }
  }

  // es copies of the run's byte into the block
  _flushRun(nblock, nblockMAX, uc, unzftab, tt, inPos) {
    let es = this._runEs + 1;
    this._runN = undefined;
    unzftab[uc] += es;
    while (es > 0) {
      if (nblock >= nblockMAX) { this._pos = inPos; throw new BzDataError(); }
      tt[nblock++] = uc;
      es--;
    }
    return nblock;
  }

  // BZ_GET_FAST: the next byte of the block into _got (true: corrupt)
  _getFast() {
    if (this._tPos >= 100000 * this._blockSize100k) return true;
    this._tPos = this._tt[this._tPos];
    this._got = this._tPos & 0xff;
    this._tPos >>>= 8;
    return false;
  }
  _randUpd() {
    if (this._rNToGo === 0) {
      this._rNToGo = BZ2_RNUMS[this._rTPos];
      this._rTPos++;
      if (this._rTPos === 512) this._rTPos = 0;
    }
    this._rNToGo--;
  }
  _randMask() { return this._rNToGo === 1 ? 1 : 0; }

  // unRLE_obuf_to_output_FAST: the block's bytes, its 4-byte runs expanded, into out (true:
  // corrupt). The structure — where it stops when out is full — is the C's.
  _unRLE(out) {
    const save1 = this._nblock + 1;
    if (this._randomised) {
      while (true) {
        // finish the current run
        while (true) {
          if (out.full()) return false;
          if (this._stateOutLen === 0) break;
          out.push(this._stateOutCh);
          this._blockCRC = ((this._blockCRC << 8) ^ BZ2_CRC32_TABLE[(this._blockCRC >>> 24) ^ this._stateOutCh]) >>> 0;
          this._stateOutLen--;
        }
        if (this._nblockUsed === save1) return false;
        if (this._nblockUsed > save1) return true;
        this._stateOutLen = 1;
        this._stateOutCh = this._k0;
        let k1;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        this._stateOutLen = 2;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        this._stateOutLen = 3;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        this._stateOutLen = k1 + 4;
        if (this._getFast()) return true; this._k0 = this._got; this._randUpd();
        this._k0 ^= this._randMask(); this._nblockUsed++;
      }
    }

    // the common case, with the state in locals (as the C keeps it in registers)
    let crc = this._blockCRC, ch = this._stateOutCh, runLen = this._stateOutLen;
    let used = this._nblockUsed, k0 = this._k0, tPos = this._tPos, k1;
    const tt = this._tt, tLimit = 100000 * this._blockSize100k;
    let corrupt = false;
    const buf = out.buf;
    let n = out.n;
    const cap = out.cap;
    outer: while (true) {
      let eqOne = false;
      if (runLen > 0) {
        // the run's bytes but its last
        while (true) {
          if (n === cap) break outer;
          if (runLen === 1) break;
          buf[n++] = ch;
          crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
          runLen--;
        }
        eqOne = true;
      }
      while (true) {
        if (eqOne) {
          // s_state_out_len_eq_one: the run's last byte
          if (n === cap) { runLen = 1; break outer; }
          buf[n++] = ch;
          crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
          eqOne = false;
        }
        if (used > save1) { corrupt = true; break outer; }
        if (used === save1) { runLen = 0; break outer; }
        ch = k0;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (k1 !== k0) { k0 = k1; eqOne = true; continue; }
        if (used === save1) { eqOne = true; continue; }
        runLen = 2;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (used === save1) continue outer;
        if (k1 !== k0) { k0 = k1; continue outer; }
        runLen = 3;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (used === save1) continue outer;
        if (k1 !== k0) { k0 = k1; continue outer; }
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        runLen = k1 + 4;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k0 = tPos & 0xff; tPos >>>= 8; used++;
        continue outer;
      }
    }
    out.n = n;
    this._blockCRC = crc; this._stateOutCh = ch; this._stateOutLen = runLen;
    this._nblockUsed = used; this._k0 = k0; this._tPos = tPos;
    return corrupt;
  }
}

const BLOCK = [0x31, 0x41, 0x59, 0x26, 0x53, 0x59];
const TRAILER = [0x17, 0x72, 0x45, 0x38, 0x50, 0x90];

// the output: grows until max bytes (max < 0: without limit)
class _Out {
  constructor(max) {
    this.max = max < 0 ? Infinity : max;
    this.buf = new Uint8Array(Math.min(this.max, 1024));
    this.n = 0;
    this.cap = this.buf.length;
  }
  full() {
    if (this.n < this.cap) return false;
    if (this.cap >= this.max) return true;
    this._grow();
    return false;
  }
  push(b) { this.buf[this.n++] = b; }
  _grow() {
    const c = Math.min(this.max, Math.max(this.cap * 2, 1024));
    const b = new Uint8Array(c);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
    this.cap = c;
  }
  result() { return this.buf.slice(0, this.n); }
}

// ── src/main.js ──

// @gcu/bz2 — bzip2, both ways, in plain JavaScript: libbzip2 1.0.8 ported, so a stream it writes
// is byte for byte the one libbzip2 (and CPython's bz2, and the bzip2 tool) writes, and what it
// reads it reads as they do — streamed, a maxLength at a time, with libbzip2's unusedData.
//
//   compress(bytes, level = 9)       → a .bz2 stream
//   decompress(bytes)                → the data of one or more concatenated streams
//   new Compressor(level)            .compress(bytes) → bytes so far; .flush() → the rest
//   new Decompressor()               .decompress(bytes, maxLength = -1); .eof, .needsInput,
//                                    .unusedData (CPython's BZ2Decompressor, member for member)



function compress(data, level = 9) {
  const c = new Compressor(level);
  const a = c.compress(data), b = c.flush();
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// as CPython's bz2.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
function decompress(data) {
  const parts = [];
  let total = 0;
  while (data.length) {
    const d = new Decompressor();
    let res;
    try { res = d.decompress(data); } catch (e) {
      if (parts.length && e instanceof BzDataError) break;
      throw e;
    }
    parts.push(res); total += res.length;
    if (!d.eof) throw new Error('bz2: compressed data ended before the end-of-stream marker was reached');
    data = d.unusedData;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
return { Compressor, Decompressor, BzDataError, compress, decompress };
})();

// -- @gcu/lzma (ext/lzma/index.js, inlined; see ext/lzma/LICENSE) --

const _gcuLzma = (() => {
// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/lzma — xz / LZMA in plain JavaScript, both directions: liblzma 5.8.1 ported, so what it writes is byte-identical to the xz tool's and CPython's lzma (every preset, the extreme ones, .xz / .lzma / raw, CRC32 / CRC64 / SHA-256, the delta and branch filters), and it reads them as liblzma does — streamed, with maxLength, needsInput and unusedData. No Wasm, no dependencies.

// ── src/lzma-encoder.js ──

// The LZMA encoder: range_encoder.h, price.h / price_tablegen.c, fastpos.h, lzma_encoder.c,
// lzma_encoder_optimum_fast.c and lzma_encoder_optimum_normal.c of liblzma 5.8.1, ported line
// for line — the parser's choices decide the bytes, so they are liblzma's. A probability is an
// index into one of the coder's Uint16Arrays; the range encoder queues (array, index, bit).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// ── constants (lzma_common.h, range_common.h, price.h) ──
const RC_SHIFT_BITS = 8, RC_TOP_VALUE$lzma_encoder = 1 << 24;
const RC_BIT_MODEL_TOTAL_BITS$lzma_encoder = 11, RC_BIT_MODEL_TOTAL$lzma_encoder = 1 << 11, RC_MOVE_BITS$lzma_encoder = 5;
const RC_MOVE_REDUCING_BITS = 4, RC_BIT_PRICE_SHIFT_BITS = 4;
const RC_INFINITY_PRICE = 1 << 30;
const RC_SYMBOLS_MAX = 53;
const RC_BIT_0 = 0, RC_BIT_1 = 1, RC_DIRECT_0 = 2, RC_DIRECT_1 = 3, RC_FLUSH = 4;

const STATES$lzma_encoder = 12, LIT_STATES$lzma_encoder = 7;
const POS_STATES_MAX$lzma_encoder = 16;
const LITERAL_CODER_SIZE$lzma_encoder = 0x300, LITERAL_CODERS_MAX$lzma_encoder = 16;
const MATCH_LEN_MIN$lzma_encoder = 2;
const LEN_LOW_BITS = 3, LEN_LOW_SYMBOLS$lzma_encoder = 8, LEN_MID_BITS = 3, LEN_MID_SYMBOLS$lzma_encoder = 8, LEN_HIGH_BITS = 8, LEN_HIGH_SYMBOLS$lzma_encoder = 256;
const LEN_SYMBOLS = LEN_LOW_SYMBOLS$lzma_encoder + LEN_MID_SYMBOLS$lzma_encoder + LEN_HIGH_SYMBOLS$lzma_encoder;
const MATCH_LEN_MAX = MATCH_LEN_MIN$lzma_encoder + LEN_SYMBOLS - 1;   // 273
const DIST_STATES$lzma_encoder = 4, DIST_SLOT_BITS = 6, DIST_SLOTS$lzma_encoder = 64;
const DIST_MODEL_START$lzma_encoder = 4, DIST_MODEL_END$lzma_encoder = 14;
const FULL_DISTANCES$lzma_encoder = 1 << 7;
const ALIGN_BITS$lzma_encoder = 4, ALIGN_SIZE$lzma_encoder = 16, ALIGN_MASK = 15;
const REPS = 4;
const OPTS = 1 << 12;
const LOOP_INPUT_MAX = OPTS + 1;
const LZMA2_CHUNK_MAX = 1 << 16;
const UINT32_MAX$lzma_encoder = 0xffffffff;

// state transitions
const updateLiteral$lzma_encoder = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);
const updateLiteralNormal = (s) => (s <= 3 ? 0 : s - 3);
const updateLiteralMatched = (s) => (s <= 9 ? s - 3 : s - 6);
const updateMatch = (s) => (s < LIT_STATES$lzma_encoder ? 7 : 10);
const updateLongRep = (s) => (s < LIT_STATES$lzma_encoder ? 8 : 11);
const updateShortRep = (s) => (s < LIT_STATES$lzma_encoder ? 9 : 11);
const isLiteralState = (s) => s < LIT_STATES$lzma_encoder;
const getDistState = (len) => (len < DIST_STATES$lzma_encoder + MATCH_LEN_MIN$lzma_encoder ? len - MATCH_LEN_MIN$lzma_encoder : DIST_STATES$lzma_encoder - 1);

// get_dist_slot (fastpos.h's HAVE_SMALL form — the same values as its table)
function getDistSlot(dist) {
  if (dist <= 4) return dist;
  const i = 31 - Math.clz32(dist);
  return (i + i) + ((dist >>> (i - 1)) & 1);
}

// lzma_rc_prices (price_tablegen.c)
const RC_PRICES = (() => {
  const t = new Uint8Array(RC_BIT_MODEL_TOTAL$lzma_encoder >>> RC_MOVE_REDUCING_BITS);
  for (let i = (1 << RC_MOVE_REDUCING_BITS) / 2; i < RC_BIT_MODEL_TOTAL$lzma_encoder; i += 1 << RC_MOVE_REDUCING_BITS) {
    const cyclesBits = RC_BIT_PRICE_SHIFT_BITS;
    let w = i, bitCount = 0;
    for (let j = 0; j < cyclesBits; ++j) {
      w = Math.imul(w, w) >>> 0;
      bitCount <<= 1;
      while (w >= (1 << 16)) { w >>>= 1; ++bitCount; }
    }
    t[i >> RC_MOVE_REDUCING_BITS] = (RC_BIT_MODEL_TOTAL_BITS$lzma_encoder << cyclesBits) - 15 - bitCount;
  }
  return t;
})();
const bitPrice = (prob, bit) => RC_PRICES[(prob ^ ((-bit) & (RC_BIT_MODEL_TOTAL$lzma_encoder - 1))) >>> RC_MOVE_REDUCING_BITS];
const bit0Price = (prob) => RC_PRICES[prob >>> RC_MOVE_REDUCING_BITS];
const bit1Price = (prob) => RC_PRICES[(prob ^ (RC_BIT_MODEL_TOTAL$lzma_encoder - 1)) >>> RC_MOVE_REDUCING_BITS];
function bittreePrice(probs, base, bitLevels, symbol) {
  let price = 0;
  symbol += 1 << bitLevels;
  do {
    const bit = symbol & 1;
    symbol >>>= 1;
    price += bitPrice(probs[base + symbol], bit);
  } while (symbol !== 1);
  return price;
}
function bittreeReversePrice(probs, base, bitLevels, symbol) {
  let price = 0, modelIndex = 1;
  do {
    const bit = symbol & 1;
    symbol >>>= 1;
    price += bitPrice(probs[base + modelIndex], bit);
    modelIndex = (modelIndex << 1) + bit;
  } while (--bitLevels !== 0);
  return price;
}
const directPrice = (bits) => bits << RC_BIT_PRICE_SHIFT_BITS;

// ── the range encoder: symbols queued, then encoded (rc_encode) into out ──
// out: { buf: Uint8Array, pos, size } (the LZMA2 chunk buffer, or a growable stream buffer)
class RangeEncoder {
  constructor() {
    this.symbols = new Uint8Array(RC_SYMBOLS_MAX);
    this.probArr = new Array(RC_SYMBOLS_MAX).fill(null);
    this.probIdx = new Int32Array(RC_SYMBOLS_MAX);
    this.reset();
  }
  reset() {
    this.low = 0;           // (a uint64 in the C: up to 2^40 here, a double holds it)
    this.cacheSize = 1;
    this.range = UINT32_MAX$lzma_encoder;
    this.cache = 0;
    this.outTotal = 0;
    this.count = 0;
    this.pos = 0;
  }
  forget() { this.count = 0; }
  bit(arr, idx, bit) {
    this.symbols[this.count] = bit;
    this.probArr[this.count] = arr;
    this.probIdx[this.count] = idx;
    ++this.count;
  }
  bittree(arr, base, bitCount, symbol) {
    let modelIndex = 1;
    do {
      const bit = (symbol >>> --bitCount) & 1;
      this.bit(arr, base + modelIndex, bit);
      modelIndex = (modelIndex << 1) + bit;
    } while (bitCount !== 0);
  }
  bittreeReverse(arr, base, bitCount, symbol) {
    let modelIndex = 1;
    do {
      const bit = symbol & 1;
      symbol >>>= 1;
      this.bit(arr, base + modelIndex, bit);
      modelIndex = (modelIndex << 1) + bit;
    } while (--bitCount !== 0);
  }
  direct(value, bitCount) {
    do {
      this.symbols[this.count++] = RC_DIRECT_0 + ((value >>> --bitCount) & 1);
    } while (bitCount !== 0);
  }
  flush() {
    for (let i = 0; i < 5; ++i) this.symbols[this.count++] = RC_FLUSH;
  }
  _shiftLow(out) {
    const lowLo = this.low % 0x100000000, lowHi = Math.floor(this.low / 0x100000000);
    if (lowLo < 0xff000000 || lowHi !== 0) {
      do {
        if (out.pos === out.size) return true;
        out.buf[out.pos] = (this.cache + lowHi) & 0xff;
        ++out.pos;
        ++this.outTotal;
        this.cache = 0xff;
      } while (--this.cacheSize !== 0);
      this.cache = (lowLo >>> 24) & 0xff;
    }
    ++this.cacheSize;
    this.low = (lowLo & 0x00ffffff) * 256;
    return false;
  }
  // true: out is full (try again with more room)
  encode(out) {
    while (this.pos < this.count) {
      if (this.range < RC_TOP_VALUE$lzma_encoder) {
        if (this._shiftLow(out)) return true;
        this.range = (this.range << RC_SHIFT_BITS) >>> 0;
      }
      switch (this.symbols[this.pos]) {
        case RC_BIT_0: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          this.range = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder, prob) >>> 0;
          prob += (RC_BIT_MODEL_TOTAL$lzma_encoder - prob) >>> RC_MOVE_BITS$lzma_encoder;
          arr[idx] = prob;
          break;
        }
        case RC_BIT_1: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          const bound = Math.imul(prob, this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder) >>> 0;
          this.low += bound;
          this.range = (this.range - bound) >>> 0;
          prob -= prob >>> RC_MOVE_BITS$lzma_encoder;
          arr[idx] = prob;
          break;
        }
        case RC_DIRECT_0:
          this.range >>>= 1;
          break;
        case RC_DIRECT_1:
          this.range >>>= 1;
          this.low += this.range;
          break;
        case RC_FLUSH:
          this.range = UINT32_MAX$lzma_encoder;
          do {
            if (this._shiftLow(out)) return true;
          } while (++this.pos < this.count);
          this.reset();
          return false;
      }
      ++this.pos;
    }
    this.count = 0;
    this.pos = 0;
    return false;
  }
  // rc_encode_dummy: would encoding what's queued (and the flush) pass outLimit bytes?
  encodeDummy(outLimit) {
    let low = this.low, cacheSize = this.cacheSize, range = this.range, cache = this.cache, outPos = this.outTotal;
    let pos = this.pos;
    const shift = () => {
      const lowLo = low % 0x100000000, lowHi = Math.floor(low / 0x100000000);
      if (lowLo < 0xff000000 || lowHi !== 0) {
        do {
          if (outPos === outLimit) return true;
          ++outPos;
          cache = 0xff;
        } while (--cacheSize !== 0);
        cache = (lowLo >>> 24) & 0xff;
      }
      ++cacheSize;
      low = (lowLo & 0x00ffffff) * 256;
      return false;
    };
    while (true) {
      if (range < RC_TOP_VALUE$lzma_encoder) {
        if (shift()) return true;
        range = (range << RC_SHIFT_BITS) >>> 0;
      }
      if (pos === this.count) break;
      switch (this.symbols[pos]) {
        case RC_BIT_0: range = Math.imul(range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder, this.probArr[pos][this.probIdx[pos]]) >>> 0; break;
        case RC_BIT_1: {
          const bound = Math.imul(this.probArr[pos][this.probIdx[pos]], range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder) >>> 0;
          low += bound;
          range = (range - bound) >>> 0;
          break;
        }
        case RC_DIRECT_0: range >>>= 1; break;
        case RC_DIRECT_1: range >>>= 1; low += range; break;
      }
      ++pos;
    }
    for (pos = 0; pos < 5; ++pos) if (shift()) return true;
    return false;
  }
  pending() { return this.cacheSize + 5 - 1; }
}

// ── the length encoder ──
// probs: [0] choice, [1] choice2, [2 + ps*8 ..] low, [2 + 128 + ps*8 ..] mid, [2 + 256 ..] high
const LC_CHOICE$lzma_encoder = 0, LC_CHOICE2$lzma_encoder = 1, LC_LOW$lzma_encoder = 2, LC_MID$lzma_encoder = 2 + POS_STATES_MAX$lzma_encoder * LEN_LOW_SYMBOLS$lzma_encoder, LC_HIGH$lzma_encoder = LC_MID$lzma_encoder + POS_STATES_MAX$lzma_encoder * LEN_MID_SYMBOLS$lzma_encoder;
class LengthEncoder {
  constructor() {
    this.probs = new Uint16Array(LC_HIGH$lzma_encoder + LEN_HIGH_SYMBOLS$lzma_encoder);
    this.prices = new Uint32Array(POS_STATES_MAX$lzma_encoder * LEN_SYMBOLS);
    this.tableSize = 0;
    this.counters = new Uint32Array(POS_STATES_MAX$lzma_encoder);
  }
  reset(numPosStates, fastMode) {
    this.probs.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    if (!fastMode) for (let ps = 0; ps < numPosStates; ++ps) this.updatePrices(ps);
  }
  updatePrices(posState) {
    const tableSize = this.tableSize, p = this.probs;
    this.counters[posState] = tableSize;
    const a0 = bit0Price(p[LC_CHOICE$lzma_encoder]);
    const a1 = bit1Price(p[LC_CHOICE$lzma_encoder]);
    const b0 = a1 + bit0Price(p[LC_CHOICE2$lzma_encoder]);
    const b1 = a1 + bit1Price(p[LC_CHOICE2$lzma_encoder]);
    const base = posState * LEN_SYMBOLS;
    let i;
    for (i = 0; i < tableSize && i < LEN_LOW_SYMBOLS$lzma_encoder; ++i) this.prices[base + i] = a0 + bittreePrice(p, LC_LOW$lzma_encoder + posState * LEN_LOW_SYMBOLS$lzma_encoder, LEN_LOW_BITS, i);
    for (; i < tableSize && i < LEN_LOW_SYMBOLS$lzma_encoder + LEN_MID_SYMBOLS$lzma_encoder; ++i) this.prices[base + i] = b0 + bittreePrice(p, LC_MID$lzma_encoder + posState * LEN_MID_SYMBOLS$lzma_encoder, LEN_MID_BITS, i - LEN_LOW_SYMBOLS$lzma_encoder);
    for (; i < tableSize; ++i) this.prices[base + i] = b1 + bittreePrice(p, LC_HIGH$lzma_encoder, LEN_HIGH_BITS, i - LEN_LOW_SYMBOLS$lzma_encoder - LEN_MID_SYMBOLS$lzma_encoder);
  }
  encode(rc, posState, len, fastMode) {
    const p = this.probs;
    len -= MATCH_LEN_MIN$lzma_encoder;
    if (len < LEN_LOW_SYMBOLS$lzma_encoder) {
      rc.bit(p, LC_CHOICE$lzma_encoder, 0);
      rc.bittree(p, LC_LOW$lzma_encoder + posState * LEN_LOW_SYMBOLS$lzma_encoder, LEN_LOW_BITS, len);
    } else {
      rc.bit(p, LC_CHOICE$lzma_encoder, 1);
      len -= LEN_LOW_SYMBOLS$lzma_encoder;
      if (len < LEN_MID_SYMBOLS$lzma_encoder) {
        rc.bit(p, LC_CHOICE2$lzma_encoder, 0);
        rc.bittree(p, LC_MID$lzma_encoder + posState * LEN_MID_SYMBOLS$lzma_encoder, LEN_MID_BITS, len);
      } else {
        rc.bit(p, LC_CHOICE2$lzma_encoder, 1);
        len -= LEN_MID_SYMBOLS$lzma_encoder;
        rc.bittree(p, LC_HIGH$lzma_encoder, LEN_HIGH_BITS, len);
      }
    }
    if (!fastMode) if (--this.counters[posState] === 0) this.updatePrices(posState);
  }
  price(len, posState) { return this.prices[posState * LEN_SYMBOLS + len - MATCH_LEN_MIN$lzma_encoder]; }
}

class Optimal {
  constructor() {
    this.state = 0;
    this.prev1IsLiteral = false;
    this.prev2 = false;
    this.posPrev2 = 0;
    this.backPrev2 = 0;
    this.price = 0;
    this.posPrev = 0;
    this.backPrev = 0;
    this.backs = new Uint32Array(REPS);
  }
}

// options: { dictSize, lc, lp, pb, mode ('fast' | 'normal'), niceLen, mf, depth }
class LzmaEncoder {
  constructor(options, { isLzma1 = false } = {}) {
    if (!(options.lc <= 4 && options.lp <= 4 && options.lc + options.lp <= 4 && options.pb <= 4)) throw new RangeError('lzma: invalid lc / lp / pb');
    if (!(options.niceLen >= MATCH_LEN_MIN$lzma_encoder && options.niceLen <= MATCH_LEN_MAX)) throw new RangeError('lzma: invalid nice_len');
    this.rc = new RangeEncoder();
    this.reps = new Uint32Array(REPS);
    this.matches = Array.from({ length: MATCH_LEN_MAX + 1 }, () => ({ len: 0, dist: 0 }));
    this.matchesCount = 0;
    this.longestMatchLength = 0;
    this.literal = new Uint16Array(LITERAL_CODERS_MAX$lzma_encoder * LITERAL_CODER_SIZE$lzma_encoder);
    this.isMatch = new Uint16Array(STATES$lzma_encoder * POS_STATES_MAX$lzma_encoder);
    this.isRep = new Uint16Array(STATES$lzma_encoder);
    this.isRep0 = new Uint16Array(STATES$lzma_encoder);
    this.isRep1 = new Uint16Array(STATES$lzma_encoder);
    this.isRep2 = new Uint16Array(STATES$lzma_encoder);
    this.isRep0Long = new Uint16Array(STATES$lzma_encoder * POS_STATES_MAX$lzma_encoder);
    this.distSlot = new Uint16Array(DIST_STATES$lzma_encoder * DIST_SLOTS$lzma_encoder);
    this.distSpecial = new Uint16Array(FULL_DISTANCES$lzma_encoder - DIST_MODEL_END$lzma_encoder);
    this.distAlign = new Uint16Array(ALIGN_SIZE$lzma_encoder);
    this.matchLenEncoder = new LengthEncoder();
    this.repLenEncoder = new LengthEncoder();
    this.distSlotPrices = new Uint32Array(DIST_STATES$lzma_encoder * DIST_SLOTS$lzma_encoder);
    this.distPrices = new Uint32Array(DIST_STATES$lzma_encoder * FULL_DISTANCES$lzma_encoder);
    this.alignPrices = new Uint32Array(ALIGN_SIZE$lzma_encoder);
    this.opts = Array.from({ length: OPTS }, () => new Optimal());
    this._repLens = new Uint32Array(REPS);
    this._repsTmp = new Uint32Array(REPS);

    // (lzma_lzma_encoder_create)
    if (options.mode === 'fast') {
      this.fastMode = true;
    } else {
      this.fastMode = false;
      let logSize = 0;
      while ((2 ** logSize) < options.dictSize) ++logSize;
      this.distTableSize = logSize * 2;
      const niceLen = Math.max(options.mf & 0x0f, options.niceLen);
      this.matchLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN$lzma_encoder;
      this.repLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN$lzma_encoder;
    }
    this.isInitialized = false;   // (a preset dictionary would set it: not supported)
    this.isFlushed = false;
    this.uncompSize = 0;
    this.outLimit = 0;
    this.useEopm = isLzma1;
    this.reset(options);
  }

  // lz options for the window this encoder needs (set_lz_options)
  static lzOptions(options) {
    return {
      beforeSize: OPTS, dictSize: options.dictSize, afterSize: LOOP_INPUT_MAX, matchLenMax: MATCH_LEN_MAX,
      niceLen: Math.max(options.mf & 0x0f, options.niceLen), matchFinder: options.mf, depth: options.depth || 0,
    };
  }

  // lzma_lzma_encoder_reset
  reset(options) {
    this.posMask = (1 << options.pb) - 1;
    this.literalContextBits = options.lc;
    this.literalMask = ((0x100 << options.lp) - (0x100 >>> options.lc)) >>> 0;
    this.rc.reset();
    this.state = 0;
    this.reps.fill(0);
    this.literal.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isMatch.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep0Long.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep0.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep1.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep2.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distSpecial.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distSlot.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distAlign.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.matchLenEncoder.reset(1 << options.pb, this.fastMode);
    this.repLenEncoder.reset(1 << options.pb, this.fastMode);
    this.matchPriceCount = (UINT32_MAX$lzma_encoder / 2) >>> 0;
    this.alignPriceCount = (UINT32_MAX$lzma_encoder / 2) >>> 0;
    this.optsEndIndex = 0;
    this.optsCurrentIndex = 0;
  }

  literalSubcoder(pos, prevByte) {
    return 3 * ((((((pos << 8) + prevByte) >>> 0) & this.literalMask) << this.literalContextBits) >>> 0);
  }

  // ── encoding a symbol ──

  _literalMatched(sub, matchByte, symbol) {
    let offset = 0x100;
    symbol += 1 << 8;
    do {
      matchByte <<= 1;
      const matchBit = matchByte & offset;
      const subcoderIndex = offset + matchBit + (symbol >>> 8);
      const bit = (symbol >>> 7) & 1;
      this.rc.bit(this.literal, sub + subcoderIndex, bit);
      symbol <<= 1;
      offset &= ~(matchByte ^ symbol);
    } while (symbol < (1 << 16));
  }

  _literal(mf, position) {
    const buf = mf.buffer;
    const curByte = buf[mf.readPos - mf.readAhead];
    const sub = this.literalSubcoder(position, buf[mf.readPos - mf.readAhead - 1]);
    if (isLiteralState(this.state)) {
      this.state = updateLiteralNormal(this.state);
      this.rc.bittree(this.literal, sub, 8, curByte);
    } else {
      this.state = updateLiteralMatched(this.state);
      const matchByte = buf[mf.readPos - this.reps[0] - 1 - mf.readAhead];
      this._literalMatched(sub, matchByte, curByte);
    }
  }

  _match(posState, distance, len) {
    this.state = updateMatch(this.state);
    this.matchLenEncoder.encode(this.rc, posState, len, this.fastMode);
    const distSlot = getDistSlot(distance);
    const distState = getDistState(len);
    this.rc.bittree(this.distSlot, distState * DIST_SLOTS$lzma_encoder, DIST_SLOT_BITS, distSlot);
    if (distSlot >= DIST_MODEL_START$lzma_encoder) {
      const footerBits = (distSlot >>> 1) - 1;
      const base = ((2 | (distSlot & 1)) << footerBits) >>> 0;
      const distReduced = (distance - base) >>> 0;
      if (distSlot < DIST_MODEL_END$lzma_encoder) {
        this.rc.bittreeReverse(this.distSpecial, base - distSlot - 1, footerBits, distReduced);
      } else {
        this.rc.direct(distReduced >>> ALIGN_BITS$lzma_encoder, footerBits - ALIGN_BITS$lzma_encoder);
        this.rc.bittreeReverse(this.distAlign, 0, ALIGN_BITS$lzma_encoder, distReduced & ALIGN_MASK);
        ++this.alignPriceCount;
      }
    }
    this.reps[3] = this.reps[2];
    this.reps[2] = this.reps[1];
    this.reps[1] = this.reps[0];
    this.reps[0] = distance;
    ++this.matchPriceCount;
  }

  _repMatch(posState, rep, len) {
    const s = this.state;
    if (rep === 0) {
      this.rc.bit(this.isRep0, s, 0);
      this.rc.bit(this.isRep0Long, s * POS_STATES_MAX$lzma_encoder + posState, len !== 1 ? 1 : 0);
    } else {
      const distance = this.reps[rep];
      this.rc.bit(this.isRep0, s, 1);
      if (rep === 1) {
        this.rc.bit(this.isRep1, s, 0);
      } else {
        this.rc.bit(this.isRep1, s, 1);
        this.rc.bit(this.isRep2, s, rep - 2);
        if (rep === 3) this.reps[3] = this.reps[2];
        this.reps[2] = this.reps[1];
      }
      this.reps[1] = this.reps[0];
      this.reps[0] = distance;
    }
    if (len === 1) {
      this.state = updateShortRep(this.state);
    } else {
      this.repLenEncoder.encode(this.rc, posState, len, this.fastMode);
      this.state = updateLongRep(this.state);
    }
  }

  _encodeSymbol(mf, back, len, position) {
    const posState = position & this.posMask;
    const s = this.state;
    if (back === UINT32_MAX$lzma_encoder) {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 0);
      this._literal(mf, position);
    } else {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 1);
      if (back < REPS) {
        this.rc.bit(this.isRep, s, 1);
        this._repMatch(posState, back, len);
      } else {
        this.rc.bit(this.isRep, s, 0);
        this._match(posState, back - REPS, len);
      }
    }
    mf.readAhead -= len;
  }

  _encodeInit(mf) {
    if (mf.readPos === mf.readLimit) {
      if (mf.action === 0) return false;   // RUN: nothing to do yet
    } else {
      mf.mfSkip(1);
      mf.readAhead = 0;
      this.rc.bit(this.isMatch, 0, 0);
      this.rc.bittree(this.literal, 0, 8, mf.buffer[0]);
      ++this.uncompSize;
    }
    this.isInitialized = true;
    return true;
  }

  _encodeEopm(position) {
    const posState = position & this.posMask;
    const s = this.state;
    this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 1);
    this.rc.bit(this.isRep, s, 0);
    this._match(posState, UINT32_MAX$lzma_encoder, MATCH_LEN_MIN$lzma_encoder);
  }

  // lzma_lzma_encode: 'ok' (needs more input, or out filled), or 'end' (flushed: a chunk, or
  // the stream). limit: UINT32_MAX, or the LZMA2 chunk's uncompressed limit
  encode(mf, out, limit) {
    if (!this.isInitialized && !this._encodeInit(mf)) return 'ok';
    if (this.rc.encode(out)) return 'ok';
    if (this.isFlushed) return 'end';
    const back = { v: 0 }, len = { v: 0 };
    while (true) {
      if (limit !== UINT32_MAX$lzma_encoder
          && ((mf.readPos - mf.readAhead) >>> 0 >= limit
            || out.pos + this.rc.pending() >= LZMA2_CHUNK_MAX - LOOP_INPUT_MAX)) break;
      if (mf.readPos >= mf.readLimit) {
        if (mf.action === 0) return 'ok';
        if (mf.readAhead === 0) break;
      }
      if (this.fastMode) this._optimumFast(mf, back, len);
      else this._optimumNormal(mf, back, len, this.uncompSize >>> 0);
      this._encodeSymbol(mf, back.v, len.v, this.uncompSize >>> 0);
      if (this.outLimit !== 0 && this.rc.encodeDummy(this.outLimit)) {
        this.rc.forget();
        break;
      }
      this.uncompSize += len.v;
      if (this.rc.encode(out)) return 'ok';
    }
    if (this.useEopm) this._encodeEopm(this.uncompSize >>> 0);
    this.rc.flush();
    if (this.rc.encode(out)) {
      this.isFlushed = true;
      return 'ok';
    }
    return 'end';
  }

  // ── lzma_encoder_optimum_fast.c ──
  _optimumFast(mf, backRes, lenRes) {
    const niceLen = mf.niceLen;
    const matches = this.matches;
    let lenMain, matchesCount;
    if (mf.readAhead === 0) {
      lenMain = mf.mfFind(matches);
      matchesCount = mf._count;
    } else {
      lenMain = this.longestMatchLength;
      matchesCount = this.matchesCount;
    }
    const b = mf.buffer;
    let buf = mf.readPos - 1;
    const bufAvail = Math.min(mf.avail() + 1, MATCH_LEN_MAX);
    if (bufAvail < 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return; }

    let repLen = 0, repIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) continue;
      const len = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
      if (len >= niceLen) {
        backRes.v = i; lenRes.v = len;
        mf.mfSkip(len - 1);
        return;
      }
      if (len > repLen) { repIndex = i; repLen = len; }
    }
    if (lenMain >= niceLen) {
      backRes.v = matches[matchesCount - 1].dist + REPS;
      lenRes.v = lenMain;
      mf.mfSkip(lenMain - 1);
      return;
    }
    let backMain = 0;
    if (lenMain >= 2) {
      backMain = matches[matchesCount - 1].dist;
      while (matchesCount > 1 && lenMain === matches[matchesCount - 2].len + 1) {
        if (!changePair(matches[matchesCount - 2].dist, backMain)) break;
        --matchesCount;
        lenMain = matches[matchesCount - 1].len;
        backMain = matches[matchesCount - 1].dist;
      }
      if (lenMain === 2 && backMain >= 0x80) lenMain = 1;
    }
    if (repLen >= 2) {
      if (repLen + 1 >= lenMain
          || (repLen + 2 >= lenMain && backMain > (1 << 9))
          || (repLen + 3 >= lenMain && backMain > (1 << 15))) {
        backRes.v = repIndex; lenRes.v = repLen;
        mf.mfSkip(repLen - 1);
        return;
      }
    }
    if (lenMain < 2 || bufAvail <= 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return; }

    this.longestMatchLength = mf.mfFind(matches);
    this.matchesCount = mf._count;
    if (this.longestMatchLength >= 2) {
      const newDist = matches[this.matchesCount - 1].dist;
      if ((this.longestMatchLength >= lenMain && newDist < backMain)
          || (this.longestMatchLength === lenMain + 1 && !changePair(backMain, newDist))
          || (this.longestMatchLength > lenMain + 1)
          || (this.longestMatchLength + 1 >= lenMain && lenMain >= 3 && changePair(newDist, backMain))) {
        backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
        return;
      }
    }
    ++buf;
    const limit = Math.max(2, lenMain - 1);
    for (let i = 0; i < REPS; ++i) {
      if (memcmplen$lzma_encoder(b, buf, buf - this.reps[i] - 1, 0, limit) === limit) {
        backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
        return;
      }
    }
    backRes.v = backMain + REPS;
    lenRes.v = lenMain;
    mf.mfSkip(lenMain - 2);
  }

  // ── lzma_encoder_optimum_normal.c ──

  _getLiteralPrice(pos, prevByte, matchMode, matchByte, symbol) {
    const sub = this.literalSubcoder(pos, prevByte);
    const p = this.literal;
    let price = 0;
    if (!matchMode) {
      price = bittreePrice(p, sub, 8, symbol);
    } else {
      let offset = 0x100;
      symbol += 1 << 8;
      do {
        matchByte <<= 1;
        const matchBit = matchByte & offset;
        const subcoderIndex = offset + matchBit + (symbol >>> 8);
        const bit = (symbol >>> 7) & 1;
        price += bitPrice(p[sub + subcoderIndex], bit);
        symbol <<= 1;
        offset &= ~(matchByte ^ symbol);
      } while (symbol < (1 << 16));
    }
    return price;
  }

  _getShortRepPrice(state, posState) {
    return bit0Price(this.isRep0[state]) + bit0Price(this.isRep0Long[state * POS_STATES_MAX$lzma_encoder + posState]);
  }

  _getPureRepPrice(repIndex, state, posState) {
    let price;
    if (repIndex === 0) {
      price = bit0Price(this.isRep0[state]);
      price += bit1Price(this.isRep0Long[state * POS_STATES_MAX$lzma_encoder + posState]);
    } else {
      price = bit1Price(this.isRep0[state]);
      if (repIndex === 1) {
        price += bit0Price(this.isRep1[state]);
      } else {
        price += bit1Price(this.isRep1[state]);
        price += bitPrice(this.isRep2[state], repIndex - 2);
      }
    }
    return price;
  }

  _getRepPrice(repIndex, len, state, posState) {
    return this.repLenEncoder.price(len, posState) + this._getPureRepPrice(repIndex, state, posState);
  }

  _getDistLenPrice(dist, len, posState) {
    const distState = getDistState(len);
    let price;
    if (dist < FULL_DISTANCES$lzma_encoder) {
      price = this.distPrices[distState * FULL_DISTANCES$lzma_encoder + dist];
    } else {
      const distSlot = getDistSlot(dist);
      price = this.distSlotPrices[distState * DIST_SLOTS$lzma_encoder + distSlot] + this.alignPrices[dist & ALIGN_MASK];
    }
    price += this.matchLenEncoder.price(len, posState);
    return price;
  }

  _fillDistPrices() {
    for (let distState = 0; distState < DIST_STATES$lzma_encoder; ++distState) {
      const dsp = distState * DIST_SLOTS$lzma_encoder;
      for (let distSlot = 0; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] = bittreePrice(this.distSlot, distState * DIST_SLOTS$lzma_encoder, DIST_SLOT_BITS, distSlot);
      }
      for (let distSlot = DIST_MODEL_END$lzma_encoder; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] += directPrice(((distSlot >>> 1) - 1) - ALIGN_BITS$lzma_encoder);
      }
      for (let i = 0; i < DIST_MODEL_START$lzma_encoder; ++i) this.distPrices[distState * FULL_DISTANCES$lzma_encoder + i] = this.distSlotPrices[dsp + i];
    }
    for (let i = DIST_MODEL_START$lzma_encoder; i < FULL_DISTANCES$lzma_encoder; ++i) {
      const distSlot = getDistSlot(i);
      const footerBits = (distSlot >>> 1) - 1;
      const base = (2 | (distSlot & 1)) << footerBits;
      const price = bittreeReversePrice(this.distSpecial, base - distSlot - 1, footerBits, i - base);
      for (let distState = 0; distState < DIST_STATES$lzma_encoder; ++distState) {
        this.distPrices[distState * FULL_DISTANCES$lzma_encoder + i] = price + this.distSlotPrices[distState * DIST_SLOTS$lzma_encoder + distSlot];
      }
    }
    this.matchPriceCount = 0;
  }

  _fillAlignPrices() {
    for (let i = 0; i < ALIGN_SIZE$lzma_encoder; ++i) this.alignPrices[i] = bittreeReversePrice(this.distAlign, 0, ALIGN_BITS$lzma_encoder, i);
    this.alignPriceCount = 0;
  }

  _backward(lenRes, backRes, cur) {
    const opts = this.opts;
    this.optsEndIndex = cur;
    let posMem = opts[cur].posPrev;
    let backMem = opts[cur].backPrev;
    do {
      if (opts[cur].prev1IsLiteral) {
        opts[posMem].backPrev = UINT32_MAX$lzma_encoder; opts[posMem].prev1IsLiteral = false;   // make_literal
        opts[posMem].posPrev = posMem - 1;
        if (opts[cur].prev2) {
          opts[posMem - 1].prev1IsLiteral = false;
          opts[posMem - 1].posPrev = opts[cur].posPrev2;
          opts[posMem - 1].backPrev = opts[cur].backPrev2;
        }
      }
      const posPrev = posMem;
      const backCur = backMem;
      backMem = opts[posPrev].backPrev;
      posMem = opts[posPrev].posPrev;
      opts[posPrev].backPrev = backCur;
      opts[posPrev].posPrev = cur;
      cur = posPrev;
    } while (cur !== 0);
    this.optsCurrentIndex = opts[0].posPrev;
    lenRes.v = opts[0].posPrev;
    backRes.v = opts[0].backPrev;
  }

  _helper1(mf, backRes, lenRes, position) {
    const niceLen = mf.niceLen;
    const matches = this.matches, opts = this.opts, b = mf.buffer;
    let lenMain, matchesCount;
    if (mf.readAhead === 0) {
      lenMain = mf.mfFind(matches);
      matchesCount = mf._count;
    } else {
      lenMain = this.longestMatchLength;
      matchesCount = this.matchesCount;
    }
    const bufAvail = Math.min(mf.avail() + 1, MATCH_LEN_MAX);
    if (bufAvail < 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return UINT32_MAX$lzma_encoder; }
    const buf = mf.readPos - 1;
    const repLens = this._repLens;
    let repMaxIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) { repLens[i] = 0; continue; }
      repLens[i] = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
      if (repLens[i] > repLens[repMaxIndex]) repMaxIndex = i;
    }
    if (repLens[repMaxIndex] >= niceLen) {
      backRes.v = repMaxIndex;
      lenRes.v = repLens[repMaxIndex];
      mf.mfSkip(lenRes.v - 1);
      return UINT32_MAX$lzma_encoder;
    }
    if (lenMain >= niceLen) {
      backRes.v = matches[matchesCount - 1].dist + REPS;
      lenRes.v = lenMain;
      mf.mfSkip(lenMain - 1);
      return UINT32_MAX$lzma_encoder;
    }
    const currentByte = b[buf];
    const matchByte = b[buf - this.reps[0] - 1];
    if (lenMain < 2 && currentByte !== matchByte && repLens[repMaxIndex] < 2) {
      backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
      return UINT32_MAX$lzma_encoder;
    }
    const state = this.state;
    opts[0].state = state;
    const posState = position & this.posMask;
    opts[1].price = bit0Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    opts[1].backPrev = UINT32_MAX$lzma_encoder; opts[1].prev1IsLiteral = false;   // make_literal
    const matchPrice = bit1Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState]);
    const repMatchPrice = matchPrice + bit1Price(this.isRep[state]);
    if (matchByte === currentByte) {
      const shortRepPrice = repMatchPrice + this._getShortRepPrice(state, posState);
      if (shortRepPrice < opts[1].price) {
        opts[1].price = shortRepPrice;
        opts[1].backPrev = 0; opts[1].prev1IsLiteral = false;   // make_short_rep
      }
    }
    const lenEnd = Math.max(lenMain, repLens[repMaxIndex]);
    if (lenEnd < 2) {
      backRes.v = opts[1].backPrev;
      lenRes.v = 1;
      return UINT32_MAX$lzma_encoder;
    }
    opts[1].posPrev = 0;
    for (let i = 0; i < REPS; ++i) opts[0].backs[i] = this.reps[i];
    let len = lenEnd;
    do {
      opts[len].price = RC_INFINITY_PRICE;
    } while (--len >= 2);
    for (let i = 0; i < REPS; ++i) {
      let repLen = repLens[i];
      if (repLen < 2) continue;
      const price = repMatchPrice + this._getPureRepPrice(i, state, posState);
      do {
        const curAndLenPrice = price + this.repLenEncoder.price(repLen, posState);
        if (curAndLenPrice < opts[repLen].price) {
          opts[repLen].price = curAndLenPrice;
          opts[repLen].posPrev = 0;
          opts[repLen].backPrev = i;
          opts[repLen].prev1IsLiteral = false;
        }
      } while (--repLen >= 2);
    }
    const normalMatchPrice = matchPrice + bit0Price(this.isRep[state]);
    len = repLens[0] >= 2 ? repLens[0] + 1 : 2;
    if (len <= lenMain) {
      let i = 0;
      while (len > matches[i].len) ++i;
      for (; ; ++len) {
        const dist = matches[i].dist;
        const curAndLenPrice = normalMatchPrice + this._getDistLenPrice(dist, len, posState);
        if (curAndLenPrice < opts[len].price) {
          opts[len].price = curAndLenPrice;
          opts[len].posPrev = 0;
          opts[len].backPrev = dist + REPS;
          opts[len].prev1IsLiteral = false;
        }
        if (len === matches[i].len) if (++i === matchesCount) break;
      }
    }
    return lenEnd;
  }

  _helper2(reps, b, buf, lenEnd, position, cur, niceLen, bufAvailFull) {
    const opts = this.opts, matches = this.matches;
    let matchesCount = this.matchesCount;
    let newLen = this.longestMatchLength;
    let posPrev = opts[cur].posPrev;
    let state;
    if (opts[cur].prev1IsLiteral) {
      --posPrev;
      if (opts[cur].prev2) {
        state = opts[opts[cur].posPrev2].state;
        if (opts[cur].backPrev2 < REPS) state = updateLongRep(state);
        else state = updateMatch(state);
      } else {
        state = opts[posPrev].state;
      }
      state = updateLiteral$lzma_encoder(state);
    } else {
      state = opts[posPrev].state;
    }
    if (posPrev === cur - 1) {
      if (opts[cur].backPrev === 0) state = updateShortRep(state);   // is_short_rep
      else state = updateLiteral$lzma_encoder(state);
    } else {
      let pos;
      if (opts[cur].prev1IsLiteral && opts[cur].prev2) {
        posPrev = opts[cur].posPrev2;
        pos = opts[cur].backPrev2;
        state = updateLongRep(state);
      } else {
        pos = opts[cur].backPrev;
        if (pos < REPS) state = updateLongRep(state);
        else state = updateMatch(state);
      }
      if (pos < REPS) {
        reps[0] = opts[posPrev].backs[pos];
        let i;
        for (i = 1; i <= pos; ++i) reps[i] = opts[posPrev].backs[i - 1];
        for (; i < REPS; ++i) reps[i] = opts[posPrev].backs[i];
      } else {
        reps[0] = pos - REPS;
        for (let i = 1; i < REPS; ++i) reps[i] = opts[posPrev].backs[i - 1];
      }
    }
    opts[cur].state = state;
    for (let i = 0; i < REPS; ++i) opts[cur].backs[i] = reps[i];
    const curPrice = opts[cur].price;
    const currentByte = b[buf];
    const matchByte = b[buf - reps[0] - 1];
    const posState = position & this.posMask;
    const curAnd1Price = curPrice
        + bit0Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    let nextIsLiteral = false;
    if (curAnd1Price < opts[cur + 1].price) {
      opts[cur + 1].price = curAnd1Price;
      opts[cur + 1].posPrev = cur;
      opts[cur + 1].backPrev = UINT32_MAX$lzma_encoder; opts[cur + 1].prev1IsLiteral = false;   // make_literal
      nextIsLiteral = true;
    }
    const matchPrice = curPrice + bit1Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState]);
    const repMatchPrice = matchPrice + bit1Price(this.isRep[state]);
    if (matchByte === currentByte && !(opts[cur + 1].posPrev < cur && opts[cur + 1].backPrev === 0)) {
      const shortRepPrice = repMatchPrice + this._getShortRepPrice(state, posState);
      if (shortRepPrice <= opts[cur + 1].price) {
        opts[cur + 1].price = shortRepPrice;
        opts[cur + 1].posPrev = cur;
        opts[cur + 1].backPrev = 0; opts[cur + 1].prev1IsLiteral = false;   // make_short_rep
        nextIsLiteral = true;
      }
    }
    if (bufAvailFull < 2) return lenEnd;
    const bufAvail = Math.min(bufAvailFull, niceLen);
    if (!nextIsLiteral && matchByte !== currentByte) {
      const bufBack = buf - reps[0] - 1;
      const limit = Math.min(bufAvailFull, niceLen + 1);
      const lenTest = memcmplen$lzma_encoder(b, buf, bufBack, 1, limit) - 1;
      if (lenTest >= 2) {
        let state2 = updateLiteral$lzma_encoder(state);
        const posStateNext = (position + 1) & this.posMask;
        const nextRepMatchPrice = curAnd1Price
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
            + bit1Price(this.isRep[state2]);
        const offset = cur + 1 + lenTest;
        while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
        const curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest, state2, posStateNext);
        if (curAndLenPrice < opts[offset].price) {
          opts[offset].price = curAndLenPrice;
          opts[offset].posPrev = cur + 1;
          opts[offset].backPrev = 0;
          opts[offset].prev1IsLiteral = true;
          opts[offset].prev2 = false;
        }
      }
    }
    let startLen = 2;
    for (let repIndex = 0; repIndex < REPS; ++repIndex) {
      const bufBack = buf - reps[repIndex] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) continue;
      let lenTest = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
      while (lenEnd < cur + lenTest) opts[++lenEnd].price = RC_INFINITY_PRICE;
      const lenTestTemp = lenTest;
      const price = repMatchPrice + this._getPureRepPrice(repIndex, state, posState);
      do {
        const curAndLenPrice = price + this.repLenEncoder.price(lenTest, posState);
        if (curAndLenPrice < opts[cur + lenTest].price) {
          opts[cur + lenTest].price = curAndLenPrice;
          opts[cur + lenTest].posPrev = cur;
          opts[cur + lenTest].backPrev = repIndex;
          opts[cur + lenTest].prev1IsLiteral = false;
        }
      } while (--lenTest >= 2);
      lenTest = lenTestTemp;
      if (repIndex === 0) startLen = lenTest + 1;
      let lenTest2 = lenTest + 1;
      const limit = Math.min(bufAvailFull, lenTest2 + niceLen);
      if (lenTest2 < limit) lenTest2 = memcmplen$lzma_encoder(b, buf, bufBack, lenTest2, limit);
      lenTest2 -= lenTest + 1;
      if (lenTest2 >= 2) {
        let state2 = updateLongRep(state);
        let posStateNext = (position + lenTest) & this.posMask;
        const curAndLenLiteralPrice = price
            + this.repLenEncoder.price(lenTest, posState)
            + bit0Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
            + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
        state2 = updateLiteral$lzma_encoder(state2);
        posStateNext = (position + lenTest + 1) & this.posMask;
        const nextRepMatchPrice = curAndLenLiteralPrice
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
            + bit1Price(this.isRep[state2]);
        const offset = cur + lenTest + 1 + lenTest2;
        while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
        const curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest2, state2, posStateNext);
        if (curAndLenPrice < opts[offset].price) {
          opts[offset].price = curAndLenPrice;
          opts[offset].posPrev = cur + lenTest + 1;
          opts[offset].backPrev = 0;
          opts[offset].prev1IsLiteral = true;
          opts[offset].prev2 = true;
          opts[offset].posPrev2 = cur;
          opts[offset].backPrev2 = repIndex;
        }
      }
    }
    if (newLen > bufAvail) {
      newLen = bufAvail;
      matchesCount = 0;
      while (newLen > matches[matchesCount].len) ++matchesCount;
      matches[matchesCount++].len = newLen;
    }
    if (newLen >= startLen) {
      const normalMatchPrice = matchPrice + bit0Price(this.isRep[state]);
      while (lenEnd < cur + newLen) opts[++lenEnd].price = RC_INFINITY_PRICE;
      let i = 0;
      while (startLen > matches[i].len) ++i;
      for (let lenTest = startLen; ; ++lenTest) {
        const curBack = matches[i].dist;
        let curAndLenPrice = normalMatchPrice + this._getDistLenPrice(curBack, lenTest, posState);
        if (curAndLenPrice < opts[cur + lenTest].price) {
          opts[cur + lenTest].price = curAndLenPrice;
          opts[cur + lenTest].posPrev = cur;
          opts[cur + lenTest].backPrev = curBack + REPS;
          opts[cur + lenTest].prev1IsLiteral = false;
        }
        if (lenTest === matches[i].len) {
          const bufBack = buf - curBack - 1;
          let lenTest2 = lenTest + 1;
          const limit = Math.min(bufAvailFull, lenTest2 + niceLen);
          if (lenTest2 < limit) lenTest2 = memcmplen$lzma_encoder(b, buf, bufBack, lenTest2, limit);
          lenTest2 -= lenTest + 1;
          if (lenTest2 >= 2) {
            let state2 = updateMatch(state);
            let posStateNext = (position + lenTest) & this.posMask;
            const curAndLenLiteralPrice = curAndLenPrice
                + bit0Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
                + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
            state2 = updateLiteral$lzma_encoder(state2);
            posStateNext = (posStateNext + 1) & this.posMask;
            const nextRepMatchPrice = curAndLenLiteralPrice
                + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
                + bit1Price(this.isRep[state2]);
            const offset = cur + lenTest + 1 + lenTest2;
            while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
            curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest2, state2, posStateNext);
            if (curAndLenPrice < opts[offset].price) {
              opts[offset].price = curAndLenPrice;
              opts[offset].posPrev = cur + lenTest + 1;
              opts[offset].backPrev = 0;
              opts[offset].prev1IsLiteral = true;
              opts[offset].prev2 = true;
              opts[offset].posPrev2 = cur;
              opts[offset].backPrev2 = curBack + REPS;
            }
          }
          if (++i === matchesCount) break;
        }
      }
    }
    return lenEnd;
  }

  _optimumNormal(mf, backRes, lenRes, position) {
    const opts = this.opts;
    if (this.optsEndIndex !== this.optsCurrentIndex) {
      lenRes.v = opts[this.optsCurrentIndex].posPrev - this.optsCurrentIndex;
      backRes.v = opts[this.optsCurrentIndex].backPrev;
      this.optsCurrentIndex = opts[this.optsCurrentIndex].posPrev;
      return;
    }
    if (mf.readAhead === 0) {
      if (this.matchPriceCount >= (1 << 7)) this._fillDistPrices();
      if (this.alignPriceCount >= ALIGN_SIZE$lzma_encoder) this._fillAlignPrices();
    }
    let lenEnd = this._helper1(mf, backRes, lenRes, position);
    if (lenEnd === UINT32_MAX$lzma_encoder) return;
    const reps = this._repsTmp;
    reps.set(this.reps);
    let cur;
    for (cur = 1; cur < lenEnd; ++cur) {
      this.longestMatchLength = mf.mfFind(this.matches);
      this.matchesCount = mf._count;
      if (this.longestMatchLength >= mf.niceLen) break;
      lenEnd = this._helper2(reps, mf.buffer, mf.readPos - 1, lenEnd, (position + cur) >>> 0, cur, mf.niceLen,
        Math.min(mf.avail() + 1, OPTS - 1 - cur));
    }
    this._backward(lenRes, backRes, cur);
  }
}

const changePair = (smallDist, bigDist) => (bigDist >>> 7) > smallDist;

function memcmplen$lzma_encoder(buf, a, b, len, limit) {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
}

// lzma_lzma_lclppb_encode
const lclppbByte = (o) => (o.pb * 5 + o.lp) * 9 + o.lc;

// ── src/check.js ──

// The integrity checks of the .xz format: CRC32 (also the LZ encoder's hash table), CRC64 and
// SHA-256, each incremental (check.c, crc32_*.c, crc64_*.c, sha256.c of liblzma, in effect —
// these are the standard algorithms, written for JavaScript). CRC64 runs on two 32-bit halves.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// CRC32: reflected, polynomial 0xEDB88320
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0, start = 0, end = buf.length) {
  let c = ~crc >>> 0;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// CRC64 (ECMA-182, reflected — polynomial 0xC96C5795D7870F42), as two 32-bit tables
const CRC64_LO = new Uint32Array(256), CRC64_HI = new Uint32Array(256);
{
  const pLo = 0xd7870f42, pHi = 0xc96c5795;
  for (let i = 0; i < 256; i++) {
    let lo = i, hi = 0;
    for (let k = 0; k < 8; k++) {
      const bit = lo & 1;
      lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
      hi = hi >>> 1;
      if (bit) { lo = (lo ^ pLo) >>> 0; hi = (hi ^ pHi) >>> 0; }
    }
    CRC64_LO[i] = lo; CRC64_HI[i] = hi;
  }
}

// state: [lo, hi] of the running CRC (pre-inverted); returns the new state
function crc64Update(state, buf, start = 0, end = buf.length) {
  let lo = state[0], hi = state[1];
  for (let i = start; i < end; i++) {
    const idx = (lo ^ buf[i]) & 0xff;
    const nlo = ((lo >>> 8) | ((hi & 0xff) << 24)) >>> 0;
    const nhi = hi >>> 8;
    lo = (nlo ^ CRC64_LO[idx]) >>> 0;
    hi = (nhi ^ CRC64_HI[idx]) >>> 0;
  }
  return [lo, hi];
}

// ── SHA-256 (FIPS 180-4) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }
  update(data, start = 0, end = data.length) {
    this.total += end - start;
    let i = start;
    if (this.bufLen) {
      while (i < end && this.bufLen < 64) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    while (i + 64 <= end) { this._block(data, i); i += 64; }
    while (i < end) this.buf[this.bufLen++] = data[i++];
    return this;
  }
  digest() {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const n = pad.length;
    const hiBits = Math.floor(bits / 0x100000000), loBits = bits >>> 0;
    pad[n - 8] = hiBits >>> 24; pad[n - 7] = hiBits >>> 16; pad[n - 6] = hiBits >>> 8; pad[n - 5] = hiBits;
    pad[n - 4] = loBits >>> 24; pad[n - 3] = loBits >>> 16; pad[n - 2] = loBits >>> 8; pad[n - 1] = loBits;
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(32);
    for (let j = 0; j < 8; j++) {
      out[j * 4] = this.h[j] >>> 24; out[j * 4 + 1] = this.h[j] >>> 16;
      out[j * 4 + 2] = this.h[j] >>> 8; out[j * 4 + 3] = this.h[j];
    }
    return out;
  }
  _block(d, o) {
    const w = this.w, h = this.h;
    for (let t = 0; t < 16; t++) w[t] = (d[o + t * 4] << 24) | (d[o + t * 4 + 1] << 16) | (d[o + t * 4 + 2] << 8) | d[o + t * 4 + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += dd; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
}

// the check IDs of the format, and their sizes on disk
const CHECK_NONE = 0, CHECK_CRC32 = 1, CHECK_CRC64 = 4, CHECK_SHA256 = 10;
const CHECK_ID_MAX = 15;
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
const checkSize = (id) => CHECK_SIZES[id];
const isCheckSupported = (id) => id === CHECK_NONE || id === CHECK_CRC32 || id === CHECK_CRC64 || id === CHECK_SHA256;

// an incremental check of type id: update(bytes), finish() → its bytes as stored (little-endian
// for the CRCs, as liblzma writes them)
class Check {
  constructor(id) {
    this.id = id;
    if (id === CHECK_CRC32) this.crc = 0;
    else if (id === CHECK_CRC64) this.st = [0xffffffff, 0xffffffff];
    else if (id === CHECK_SHA256) this.sha = new Sha256();
  }
  update(buf, start = 0, end = buf.length) {
    if (this.id === CHECK_CRC32) this.crc = crc32(buf, this.crc, start, end);
    else if (this.id === CHECK_CRC64) this.st = crc64Update(this.st, buf, start, end);
    else if (this.id === CHECK_SHA256) this.sha.update(buf, start, end);
  }
  finish() {
    if (this.id === CHECK_NONE) return new Uint8Array(0);
    if (this.id === CHECK_CRC32) { const c = this.crc, o = new Uint8Array(4); o[0] = c; o[1] = c >>> 8; o[2] = c >>> 16; o[3] = c >>> 24; return o; }
    if (this.id === CHECK_CRC64) {
      const lo = ~this.st[0] >>> 0, hi = ~this.st[1] >>> 0, o = new Uint8Array(8);
      o[0] = lo; o[1] = lo >>> 8; o[2] = lo >>> 16; o[3] = lo >>> 24; o[4] = hi; o[5] = hi >>> 8; o[6] = hi >>> 16; o[7] = hi >>> 24;
      return o;
    }
    return this.sha.digest();
  }
}

// ── src/lz-encoder.js ──

// The LZ encoder's window and match finders: lz_encoder.c + lz_encoder_mf.c of liblzma 5.8.1,
// ported line for line (hash chains hc3 / hc4, binary trees bt2 / bt3 / bt4). Positions are
// uint32 arithmetic as in the C (`>>> 0` where a subtraction may wrap).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const MF_HC3 = 0x03, MF_HC4 = 0x04, MF_BT2 = 0x12, MF_BT3 = 0x13, MF_BT4 = 0x14;
const HASH_2_SIZE = 1 << 10, HASH_3_SIZE = 1 << 16;
const HASH_2_MASK = HASH_2_SIZE - 1, HASH_3_MASK = HASH_3_SIZE - 1;
const FIX_3_HASH_SIZE = HASH_2_SIZE, FIX_4_HASH_SIZE = HASH_2_SIZE + HASH_3_SIZE;
const EMPTY_HASH_VALUE = 0;
const MUST_NORMALIZE_POS = 0xffffffff;

const RUN$lz_encoder = 0, SYNC_FLUSH = 1, FINISH$lz_encoder = 3;

const memcmplen$lz_encoder = (buf, a, b, len, limit) => {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
};

class MatchFinder {
  // opts: { beforeSize, dictSize, afterSize, matchLenMax, niceLen, matchFinder, depth }
  constructor(opts) {
    const { beforeSize, dictSize, afterSize, matchLenMax, niceLen, matchFinder } = opts;
    if (dictSize < 4096 || dictSize > (1 << 30) + (1 << 29) || niceLen > matchLenMax) throw new RangeError('lzma: invalid LZ options');
    this.keepSizeBefore = beforeSize + dictSize;
    this.keepSizeAfter = afterSize + matchLenMax;
    let reserve = (dictSize / 2) >>> 0;
    if (reserve > (1 << 30)) reserve = (reserve / 2) >>> 0;
    reserve += (((beforeSize + matchLenMax + afterSize) / 2) >>> 0) + (1 << 19);
    this.size = this.keepSizeBefore + reserve + this.keepSizeAfter;
    this.matchLenMax = matchLenMax;
    this.niceLen = niceLen;
    this.cyclicSize = dictSize + 1;
    this.matchFinder = matchFinder;
    switch (matchFinder) {
      case MF_HC3: this.find = this._hc3Find; this.skip = this._hc3Skip; break;
      case MF_HC4: this.find = this._hc4Find; this.skip = this._hc4Skip; break;
      case MF_BT2: this.find = this._bt2Find; this.skip = this._bt2Skip; break;
      case MF_BT3: this.find = this._bt3Find; this.skip = this._bt3Skip; break;
      case MF_BT4: this.find = this._bt4Find; this.skip = this._bt4Skip; break;
      default: throw new RangeError('lzma: invalid match finder');
    }
    const hashBytes = matchFinder & 0x0f;
    const isBt = (matchFinder & 0x10) !== 0;
    let hs;
    if (hashBytes === 2) {
      hs = 0xffff;
    } else {
      hs = dictSize - 1;
      hs |= hs >>> 1; hs |= hs >>> 2; hs |= hs >>> 4; hs |= hs >>> 8;
      hs >>>= 1;
      hs |= 0xffff;
      if (hs > (1 << 24)) {
        if (hashBytes === 3) hs = (1 << 24) - 1;
        else hs >>>= 1;
      }
    }
    this.hashMask = hs >>> 0;
    ++hs;
    if (hashBytes > 2) hs += HASH_2_SIZE;
    if (hashBytes > 3) hs += HASH_3_SIZE;
    this.hashCount = hs;
    this.sonsCount = isBt ? this.cyclicSize * 2 : this.cyclicSize;
    this.depth = opts.depth;
    if (!this.depth) this.depth = isBt ? 16 + ((niceLen / 2) >>> 0) : 4 + ((niceLen / 4) >>> 0);

    // (lz_encoder_init)
    this.buffer = new Uint8Array(this.size);
    this.offset = this.cyclicSize;
    this.readPos = 0;
    this.readAhead = 0;
    this.readLimit = 0;
    this.writePos = 0;
    this.pending = 0;
    this.hash = new Uint32Array(this.hashCount);
    // (son is indexed only below the cyclic position it has reached — 2 per position for the
    // binary trees — so it grows with the data instead of starting at its full, dictionary-sized
    // length, which liblzma leaves to the OS to commit lazily)
    this._sonPer = isBt ? 2 : 1;
    this.son = new Uint32Array(Math.min(this.sonsCount, this._sonPer * 65536));
    this.cyclicPos = 0;
    this.action = RUN$lz_encoder;
  }

  avail() { return this.writePos - this.readPos; }
  unencoded() { return this.writePos - this.readPos + this.readAhead; }
  position() { return this.readPos - this.readAhead; }

  // fill_window (move_window first when due): produce(buffer, writePos, size) writes input into
  // the window — the input itself, or what the filters before this one make of it — and returns
  // the new writePos and whether that was the end (the action's: FINISH, all input consumed)
  fill(produce, action) {
    if (this.readPos >= this.size - this.keepSizeAfter) this._moveWindow();
    const r = produce(this.buffer, this.writePos, this.size);
    this.writePos = r.pos;
    if (r.end) {
      this.action = action;
      this.readLimit = this.writePos;
    } else if (this.writePos > this.keepSizeAfter) {
      this.readLimit = this.writePos - this.keepSizeAfter;
    }
    if (this.pending > 0 && this.readPos < this.readLimit) {
      const pending = this.pending;
      this.pending = 0;
      this.readPos -= pending;
      this.skip(pending);
    }
  }

  _moveWindow() {
    const moveOffset = ((this.readPos - this.keepSizeBefore) & ~15) >>> 0;
    const moveSize = this.writePos - moveOffset;
    this.buffer.copyWithin(0, moveOffset, moveOffset + moveSize);
    this.offset = (this.offset + moveOffset) >>> 0;
    this.readPos -= moveOffset;
    this.readLimit -= moveOffset;
    this.writePos -= moveOffset;
  }

  // lzma_mf_find: the matches at the current position (into matches[], a { len, dist } array);
  // returns [count, lenBest]
  mfFind(matches) {
    const count = this.find(matches);
    let lenBest = 0;
    if (count > 0) {
      lenBest = matches[count - 1].len;
      if (lenBest === this.niceLen) {
        let limit = this.avail() + 1;
        if (limit > this.matchLenMax) limit = this.matchLenMax;
        const p1 = this.readPos - 1;
        const p2 = p1 - matches[count - 1].dist - 1;
        lenBest = memcmplen$lz_encoder(this.buffer, p1, p2, lenBest, limit);
      }
    }
    ++this.readAhead;
    this._count = count;
    return lenBest;
  }

  mfSkip(amount) {
    if (amount !== 0) {
      this.skip(amount);
      this.readAhead += amount;
    }
  }

  _growSon() {
    const n = Math.min(this.sonsCount, this.son.length * 2);
    const s = new Uint32Array(n);
    s.set(this.son);
    this.son = s;
  }

  _normalize() {
    const subvalue = (MUST_NORMALIZE_POS - this.cyclicSize) >>> 0;
    const h = this.hash, s = this.son;
    for (let i = 0; i < this.hashCount; ++i) h[i] = h[i] <= subvalue ? EMPTY_HASH_VALUE : h[i] - subvalue;
    for (let i = 0; i < s.length; ++i) s[i] = s[i] <= subvalue ? EMPTY_HASH_VALUE : s[i] - subvalue;
    this.offset = (this.offset - subvalue) >>> 0;
  }

  _movePos() {
    if (++this.cyclicPos === this.cyclicSize) this.cyclicPos = 0;
    if ((this.cyclicPos + 1) * this._sonPer > this.son.length) this._growSon();
    ++this.readPos;
    if (((this.readPos + this.offset) >>> 0) === 0xffffffff) this._normalize();
  }

  _movePending() {
    ++this.readPos;
    ++this.pending;
  }

  // header(): the length limit, or -1 when there is too little input (move_pending done)
  _header(isBt, lenMin) {
    let lenLimit = this.avail();
    if (this.niceLen <= lenLimit) {
      lenLimit = this.niceLen;
    } else if (lenLimit < lenMin || (isBt && this.action === SYNC_FLUSH)) {
      this._movePending();
      return -1;
    }
    return lenLimit;
  }

  // ── hash chains ──

  _hcFindFunc(lenLimit, pos, cur, curMatch, depth, matches, mc, lenBest) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    son[cyclicPos] = curMatch;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) return mc;
      const pb = cur - delta;
      curMatch = son[cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)];
      if (buf[pb + lenBest] === buf[cur + lenBest] && buf[pb] === buf[cur]) {
        const len = memcmplen$lz_encoder(buf, pb, cur, 1, lenLimit);
        if (lenBest < len) {
          lenBest = len;
          matches[mc].len = len;
          matches[mc].dist = delta - 1;
          ++mc;
          if (len === lenLimit) return mc;
        }
      }
    }
  }

  _hc3Find(matches) {
    const lenLimit = this._header(false, 3);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen$lz_encoder(buf, cur - delta2, cur, lenBest, lenLimit);
      matches[0].len = lenBest;
      matches[0].dist = delta2 - 1;
      mc = 1;
      if (lenBest === lenLimit) {
        this.son[this.cyclicPos] = curMatch;
        this._movePos();
        return 1;
      }
    }
    mc = this._hcFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _hc3Skip(amount) {
    const buf = this.buffer;
    do {
      if (this.avail() < 3) { this._movePending(); continue; }
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
      this.son[this.cyclicPos] = curMatch;
      this._movePos();
    } while (--amount !== 0);
  }

  _hc4Find(matches) {
    const lenLimit = this._header(false, 4);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
    let delta2 = (pos - this.hash[hash2]) >>> 0;
    const delta3 = (pos - this.hash[FIX_3_HASH_SIZE + hash3]) >>> 0;
    const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hash3] = pos;
    this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
    let lenBest = 1;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = 2;
      matches[0].len = 2;
      matches[0].dist = delta2 - 1;
      mc = 1;
    }
    if (delta2 !== delta3 && delta3 < this.cyclicSize && buf[cur - delta3] === buf[cur]) {
      lenBest = 3;
      matches[mc++].dist = delta3 - 1;
      delta2 = delta3;
    }
    if (mc !== 0) {
      lenBest = memcmplen$lz_encoder(buf, cur - delta2, cur, lenBest, lenLimit);
      matches[mc - 1].len = lenBest;
      if (lenBest === lenLimit) {
        this.son[this.cyclicPos] = curMatch;
        this._movePos();
        return mc;
      }
    }
    if (lenBest < 3) lenBest = 3;
    mc = this._hcFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _hc4Skip(amount) {
    const buf = this.buffer;
    do {
      if (this.avail() < 4) { this._movePending(); continue; }
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hash3] = pos;
      this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
      this.son[this.cyclicPos] = curMatch;
      this._movePos();
    } while (--amount !== 0);
  }

  // ── binary trees ──

  _btFindFunc(lenLimit, pos, cur, curMatch, depth, matches, mc, lenBest) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    let ptr0 = (cyclicPos << 1) + 1;
    let ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) {
        son[ptr0] = EMPTY_HASH_VALUE;
        son[ptr1] = EMPTY_HASH_VALUE;
        return mc;
      }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)) << 1;
      const pb = cur - delta;
      let len = Math.min(len0, len1);
      if (buf[pb + len] === buf[cur + len]) {
        len = memcmplen$lz_encoder(buf, pb, cur, len + 1, lenLimit);
        if (lenBest < len) {
          lenBest = len;
          matches[mc].len = len;
          matches[mc].dist = delta - 1;
          ++mc;
          if (len === lenLimit) {
            son[ptr1] = son[pair];
            son[ptr0] = son[pair + 1];
            return mc;
          }
        }
      }
      if (buf[pb + len] < buf[cur + len]) {
        son[ptr1] = curMatch;
        ptr1 = pair + 1;
        curMatch = son[ptr1];
        len1 = len;
      } else {
        son[ptr0] = curMatch;
        ptr0 = pair;
        curMatch = son[ptr0];
        len0 = len;
      }
    }
  }

  _btSkipFunc(lenLimit, pos, cur, curMatch, depth) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    let ptr0 = (cyclicPos << 1) + 1;
    let ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) {
        son[ptr0] = EMPTY_HASH_VALUE;
        son[ptr1] = EMPTY_HASH_VALUE;
        return;
      }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)) << 1;
      const pb = cur - delta;
      let len = Math.min(len0, len1);
      if (buf[pb + len] === buf[cur + len]) {
        len = memcmplen$lz_encoder(buf, pb, cur, len + 1, lenLimit);
        if (len === lenLimit) {
          son[ptr1] = son[pair];
          son[ptr0] = son[pair + 1];
          return;
        }
      }
      if (buf[pb + len] < buf[cur + len]) {
        son[ptr1] = curMatch;
        ptr1 = pair + 1;
        curMatch = son[ptr1];
        len1 = len;
      } else {
        son[ptr0] = curMatch;
        ptr0 = pair;
        curMatch = son[ptr0];
        len0 = len;
      }
    }
  }

  _bt2Find(matches) {
    const lenLimit = this._header(true, 2);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    const hashValue = buf[cur] | (buf[cur + 1] << 8);
    const curMatch = this.hash[hashValue];
    this.hash[hashValue] = pos;
    const mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, 0, 1);
    this._movePos();
    return mc;
  }

  _bt2Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 2);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const hashValue = buf[cur] | (buf[cur + 1] << 8);
      const curMatch = this.hash[hashValue];
      this.hash[hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  _bt3Find(matches) {
    const lenLimit = this._header(true, 3);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen$lz_encoder(buf, cur, cur - delta2, lenBest, lenLimit);
      matches[0].len = lenBest;
      matches[0].dist = delta2 - 1;
      mc = 1;
      if (lenBest === lenLimit) {
        this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
        this._movePos();
        return 1;
      }
    }
    mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _bt3Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 3);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  _bt4Find(matches) {
    const lenLimit = this._header(true, 4);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
    let delta2 = (pos - this.hash[hash2]) >>> 0;
    const delta3 = (pos - this.hash[FIX_3_HASH_SIZE + hash3]) >>> 0;
    const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hash3] = pos;
    this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
    let lenBest = 1;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = 2;
      matches[0].len = 2;
      matches[0].dist = delta2 - 1;
      mc = 1;
    }
    if (delta2 !== delta3 && delta3 < this.cyclicSize && buf[cur - delta3] === buf[cur]) {
      lenBest = 3;
      matches[mc++].dist = delta3 - 1;
      delta2 = delta3;
    }
    if (mc !== 0) {
      lenBest = memcmplen$lz_encoder(buf, cur, cur - delta2, lenBest, lenLimit);
      matches[mc - 1].len = lenBest;
      if (lenBest === lenLimit) {
        this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
        this._movePos();
        return mc;
      }
    }
    if (lenBest < 3) lenBest = 3;
    mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _bt4Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 4);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hash3] = pos;
      this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  // mf_read (an uncompressed LZMA2 chunk): `left` bytes ending at readPos
  readBack(left) {
    return this.buffer.subarray(this.readPos - left, this.readPos);
  }
}

// ── src/lzma2-encoder.js ──

// The LZMA2 encoder: lzma2_encoder.c of liblzma 5.8.1, ported — LZMA in chunks of at most 2 MiB
// uncompressed / 64 KiB compressed, each stored uncompressed instead when that is smaller; plus
// the LZMA2 / LZMA1 property bytes.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const LZMA2_UNCOMPRESSED_MAX = 1 << 21;
const LZMA2_HEADER_MAX = 6, LZMA2_HEADER_UNCOMPRESSED = 3;
const SEQ_INIT = 0, SEQ_LZMA_ENCODE = 1, SEQ_LZMA_COPY = 2, SEQ_UNCOMPRESSED_HEADER = 3, SEQ_UNCOMPRESSED_COPY = 4;

// lzma_lzma2_props_encode: the dictionary size as one byte
function lzma2Props(dictSize) {
  let d = Math.max(dictSize, 4096) - 1;
  d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
  d >>>= 0;
  return d === 0xffffffff ? 40 : getDistSlot(d + 1) - 24;
}

// lzma_lzma_props_encode (LZMA1 / .lzma): lc/lp/pb byte, then the dictionary size LE
function lzma1Props(o) {
  const out = new Uint8Array(5);
  out[0] = lclppbByte(o);
  out[1] = o.dictSize; out[2] = o.dictSize >>> 8; out[3] = o.dictSize >>> 16; out[4] = o.dictSize >>> 24;
  return out;
}

// LZMA2 over a window: write(data, finishing) consumes input; pull(out) emits the stream
class Lzma2Encoder {
  constructor(options) {
    this.opt = options;
    this.lzma = new LzmaEncoder(options);
    const lz = LzmaEncoder.lzOptions(options);
    // (lzma2_encoder_init: room for a whole chunk before the dictionary)
    if (lz.beforeSize + lz.dictSize < LZMA2_CHUNK_MAX) lz.beforeSize = LZMA2_CHUNK_MAX - lz.dictSize;
    this.mf = new MatchFinder(lz);
    this.sequence = SEQ_INIT;
    this.needProperties = true;
    this.needStateReset = false;
    this.needDictionaryReset = true;
    this.uncompressedSize = 0;
    this.compressedSize = 0;
    this.bufPos = 0;
    this.buf = new Uint8Array(LZMA2_HEADER_MAX + LZMA2_CHUNK_MAX);
  }

  _headerLzma() {
    let pos;
    if (this.needProperties) {
      pos = 0;
      this.buf[pos] = this.needDictionaryReset ? 0x80 + (3 << 5) : 0x80 + (2 << 5);
    } else {
      pos = 1;
      this.buf[pos] = this.needStateReset ? 0x80 + (1 << 5) : 0x80;
    }
    this.bufPos = pos;
    let size = this.uncompressedSize - 1;
    this.buf[pos++] += size >>> 16;
    this.buf[pos++] = (size >>> 8) & 0xff;
    this.buf[pos++] = size & 0xff;
    size = this.compressedSize - 1;
    this.buf[pos++] = size >>> 8;
    this.buf[pos++] = size & 0xff;
    if (this.needProperties) this.buf[pos] = lclppbByte(this.opt);
    this.needProperties = false;
    this.needStateReset = false;
    this.needDictionaryReset = false;
    this.compressedSize += LZMA2_HEADER_MAX;
  }

  _headerUncompressed() {
    this.buf[0] = this.needDictionaryReset ? 1 : 2;
    this.needDictionaryReset = false;
    this.buf[1] = (this.uncompressedSize - 1) >>> 8;
    this.buf[2] = (this.uncompressedSize - 1) & 0xff;
    this.bufPos = 0;
  }

  // lzma2_encode, writing into out { buf, pos, size }: 'ok' (more input wanted, or out full),
  // 'end' (the end marker written, at FINISH)
  code(out) {
    const mf = this.mf;
    while (out.pos < out.size) {
      switch (this.sequence) {
        case SEQ_INIT: {
          if (mf.unencoded() === 0) {
            if (mf.action !== RUN$lz_encoder) { out.buf[out.pos++] = 0; return 'end'; }
            return 'ok';
          }
          if (this.needStateReset) this.lzma.reset(this.opt);
          this.uncompressedSize = 0;
          this.compressedSize = 0;
          this.sequence = SEQ_LZMA_ENCODE;
        }
        // falls through
        case SEQ_LZMA_ENCODE: {
          const left = LZMA2_UNCOMPRESSED_MAX - this.uncompressedSize;
          let limit;
          if (left < mf.matchLenMax) limit = 0;
          else limit = (mf.readPos - mf.readAhead + left - mf.matchLenMax) >>> 0;
          const readStart = mf.readPos - mf.readAhead;
          // (the LZMA output is the chunk buffer past its header: its size test counts from there)
          const chunk = { buf: this._body || (this._body = this.buf.subarray(LZMA2_HEADER_MAX)), pos: this.compressedSize, size: LZMA2_CHUNK_MAX };
          const ret = this.lzma.encode(mf, chunk, limit);
          this.compressedSize = chunk.pos;
          this.uncompressedSize += mf.readPos - mf.readAhead - readStart;
          if (ret !== 'end') return 'ok';
          if (this.compressedSize >= this.uncompressedSize) {
            this.uncompressedSize += mf.readAhead;
            mf.readAhead = 0;
            this._headerUncompressed();
            this.needStateReset = true;
            this.sequence = SEQ_UNCOMPRESSED_HEADER;
            break;
          }
          this._headerLzma();
          this.sequence = SEQ_LZMA_COPY;
        }
        // falls through
        case SEQ_LZMA_COPY: {
          const end = this.compressedSize;
          const n = Math.min(end - this.bufPos, out.size - out.pos);
          out.buf.set(this.buf.subarray(this.bufPos, this.bufPos + n), out.pos);
          this.bufPos += n; out.pos += n;
          if (this.bufPos !== end) return 'ok';
          this.sequence = SEQ_INIT;
          break;
        }
        case SEQ_UNCOMPRESSED_HEADER: {
          const n = Math.min(LZMA2_HEADER_UNCOMPRESSED - this.bufPos, out.size - out.pos);
          out.buf.set(this.buf.subarray(this.bufPos, this.bufPos + n), out.pos);
          this.bufPos += n; out.pos += n;
          if (this.bufPos !== LZMA2_HEADER_UNCOMPRESSED) return 'ok';
          this.sequence = SEQ_UNCOMPRESSED_COPY;
        }
        // falls through
        case SEQ_UNCOMPRESSED_COPY: {
          // mf_read: the chunk's bytes, ending at the read position
          const n = Math.min(out.size - out.pos, this.uncompressedSize);
          out.buf.set(mf.buffer.subarray(mf.readPos - this.uncompressedSize, mf.readPos - this.uncompressedSize + n), out.pos);
          out.pos += n;
          this.uncompressedSize -= n;
          if (this.uncompressedSize !== 0) return 'ok';
          this.sequence = SEQ_INIT;
          break;
        }
      }
    }
    return 'ok';
  }
}

// ── src/filters.js ──

// The filters before (or, decoding, after) LZMA: delta (delta_*.c) and the branch / call /
// jump converters (simple_coder.c and simple/*.c — x86, PowerPC, IA-64, ARM, ARM-Thumb, ARM64,
// SPARC, RISC-V) of liblzma 5.8.1, ported. A coder fills out[outPos..outSize) from its `next` —
// the input, or another coder — and reports whether that was the end; liblzma's chain the same
// way round, encoding and decoding alike.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

const RUN$filters = 0, FINISH$filters = 3;

// the raw input of an encoder chain: set .data / .pos, then pull
class InputSource {
  constructor() { this.data = new Uint8Array(0); this.pos = 0; }
  code(out, outPos, outSize, action) {
    const n = Math.min(this.data.length - this.pos, outSize - outPos);
    if (n > 0) out.set(this.data.subarray(this.pos, this.pos + n), outPos);
    this.pos += n;
    return { pos: outPos + n, end: action !== RUN$filters && this.pos === this.data.length };
  }
}

// ── delta ──
class DeltaCoder {
  constructor(next, dist, isEncoder) {
    if (!(dist >= 1 && dist <= 256)) throw new RangeError('lzma: delta distance must be 1..256');
    this.next = next; this.distance = dist; this.isEncoder = isEncoder;
    this.history = new Uint8Array(256); this.pos = 0;
  }
  code(out, outPos, outSize, action) {
    const r = this.next.code(out, outPos, outSize, action);
    const h = this.history, d = this.distance;
    if (this.isEncoder) {
      for (let i = outPos; i < r.pos; ++i) {
        const tmp = h[(d + this.pos) & 0xff];
        h[this.pos-- & 0xff] = out[i];
        out[i] = (out[i] - tmp) & 0xff;
      }
    } else {
      for (let i = outPos; i < r.pos; ++i) {
        out[i] = (out[i] + h[(d + this.pos) & 0xff]) & 0xff;
        h[this.pos-- & 0xff] = out[i];
      }
    }
    return r;
  }
}

// ── BCJ: simple_coder.c's buffering around a filter kernel ──
class SimpleCoder {
  // kernel(state, nowPos, isEncoder, buffer, start, size) → bytes filtered
  constructor(next, kernel, unfilteredMax, alignment, isEncoder, startOffset = 0, state = null) {
    if (startOffset & (alignment - 1)) throw new RangeError('lzma: start_offset is not aligned for this filter');
    this.next = next; this.kernel = kernel; this.isEncoder = isEncoder; this.state = state;
    this.nowPos = startOffset >>> 0;
    this.allocated = 2 * unfilteredMax;
    this.buffer = new Uint8Array(this.allocated);
    this.endWasReached = false;
    this.pos = 0; this.filtered = 0; this.size = 0;
  }
  _callFilter(buf, start, size) {
    const filtered = this.kernel(this.state, this.nowPos, this.isEncoder, buf, start, size);
    this.nowPos = (this.nowPos + filtered) >>> 0;
    return filtered;
  }
  _copyOrCode(out, outPos, outSize, action) {
    const r = this.next.code(out, outPos, outSize, action);
    if (r.end) this.endWasReached = true;
    return r.pos;
  }
  code(out, outPos, outSize, action) {
    if (this.pos < this.filtered) {
      const n = Math.min(this.filtered - this.pos, outSize - outPos);
      out.set(this.buffer.subarray(this.pos, this.pos + n), outPos);
      this.pos += n; outPos += n;
      if (this.pos < this.filtered) return { pos: outPos, end: false };
      if (this.endWasReached) return { pos: outPos, end: true };
    }
    this.filtered = 0;
    const outAvail = outSize - outPos;
    const bufAvail = this.size - this.pos;
    if (outAvail > bufAvail || bufAvail === 0) {
      const outStart = outPos;
      if (bufAvail > 0) out.set(this.buffer.subarray(this.pos, this.pos + bufAvail), outPos);
      outPos += bufAvail;
      outPos = this._copyOrCode(out, outPos, outSize, action);
      const size = outPos - outStart;
      const filtered = size === 0 ? 0 : this._callFilter(out, outStart, size);
      const unfiltered = size - filtered;
      this.pos = 0;
      this.size = unfiltered;
      if (this.endWasReached) {
        this.size = 0;
      } else if (unfiltered > 0) {
        outPos -= unfiltered;
        this.buffer.set(out.subarray(outPos, outPos + unfiltered), 0);
      }
    } else if (this.pos > 0) {
      this.buffer.copyWithin(0, this.pos, this.pos + bufAvail);
      this.size -= this.pos;
      this.pos = 0;
    }
    if (this.size > 0) {
      this.size = this._copyOrCode(this.buffer, this.size, this.allocated, action);
      this.filtered = this._callFilter(this.buffer, 0, this.size);
      if (this.endWasReached) this.filtered = this.size;
      const n = Math.min(this.filtered - this.pos, outSize - outPos);
      out.set(this.buffer.subarray(this.pos, this.pos + n), outPos);
      this.pos += n; outPos += n;
    }
    return { pos: outPos, end: this.endWasReached && this.pos === this.size };
  }
}

// ── the kernels (buffer[start .. start + size)) ──

const test86 = (b) => b === 0 || b === 0xff;
const MASK_TO_BIT_NUMBER = [0, 1, 2, 2, 3];
function x86(s, nowPos, isEncoder, buf, start, size) {
  let prevMask = s.prevMask, prevPos = s.prevPos;
  if (size < 5) return 0;
  if (((nowPos - prevPos) >>> 0) > 5) prevPos = (nowPos - 5) >>> 0;
  const limit = size - 5;
  let bp = 0;
  while (bp <= limit) {
    let b = buf[start + bp];
    if (b !== 0xe8 && b !== 0xe9) { ++bp; continue; }
    const offset = (nowPos + bp - prevPos) >>> 0;
    prevPos = (nowPos + bp) >>> 0;
    if (offset > 5) {
      prevMask = 0;
    } else {
      for (let i = 0; i < offset; ++i) { prevMask &= 0x77; prevMask <<= 1; }
    }
    b = buf[start + bp + 4];
    if (test86(b) && (prevMask >>> 1) <= 4 && (prevMask >>> 1) !== 3) {
      let src = ((b << 24) | (buf[start + bp + 3] << 16) | (buf[start + bp + 2] << 8) | buf[start + bp + 1]) >>> 0;
      let dest;
      while (true) {
        if (isEncoder) dest = (src + (nowPos + bp + 5)) >>> 0;
        else dest = (src - (nowPos + bp + 5)) >>> 0;
        if (prevMask === 0) break;
        const i = MASK_TO_BIT_NUMBER[prevMask >>> 1];
        b = (dest >>> (24 - i * 8)) & 0xff;
        if (!test86(b)) break;
        src = (dest ^ ((2 ** (32 - i * 8)) - 1)) >>> 0;
      }
      buf[start + bp + 4] = ~(((dest >>> 24) & 1) - 1) & 0xff;
      buf[start + bp + 3] = dest >>> 16;
      buf[start + bp + 2] = dest >>> 8;
      buf[start + bp + 1] = dest;
      bp += 5;
      prevMask = 0;
    } else {
      ++bp;
      prevMask |= 1;
      if (test86(b)) prevMask |= 0x10;
    }
  }
  s.prevMask = prevMask; s.prevPos = prevPos;
  return bp;
}

function powerpc(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if ((buf[o] >>> 2) === 0x12 && (buf[o + 3] & 3) === 1) {
      const src = (((buf[o] & 3) << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | (buf[o + 3] & ~3)) >>> 0;
      const dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
      buf[o] = 0x48 | ((dest >>> 24) & 0x03);
      buf[o + 1] = dest >>> 16;
      buf[o + 2] = dest >>> 8;
      buf[o + 3] = (buf[o + 3] & 0x03) | (dest & 0xff);
    }
  }
  return i;
}

const IA64_BRANCH_TABLE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 6, 6, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 0, 0];
function ia64(s, nowPos, isEncoder, buf, start, size) {
  size &= ~15;
  let i;
  for (i = 0; i < size; i += 16) {
    const o = start + i;
    const mask = IA64_BRANCH_TABLE[buf[o] & 0x1f];
    let bitPos = 5;
    for (let slot = 0; slot < 3; ++slot, bitPos += 41) {
      if (((mask >>> slot) & 1) === 0) continue;
      const bytePos = bitPos >>> 3;
      const bitRes = BigInt(bitPos & 7);
      let instruction = 0n;
      for (let j = 0; j < 6; ++j) instruction |= BigInt(buf[o + j + bytePos]) << BigInt(8 * j);
      let instNorm = instruction >> bitRes;
      if (((instNorm >> 37n) & 0xfn) === 5n && ((instNorm >> 9n) & 7n) === 0n) {
        let src = Number((instNorm >> 13n) & 0xfffffn);
        src |= Number((instNorm >> 36n) & 1n) << 20;
        src = (src << 4) >>> 0;
        let dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
        dest >>>= 4;
        instNorm &= ~(0x8fffffn << 13n);
        instNorm |= BigInt(dest & 0xfffff) << 13n;
        instNorm |= BigInt(dest & 0x100000) << (36n - 20n);
        instruction &= (1n << bitRes) - 1n;
        instruction |= instNorm << bitRes;
        for (let j = 0; j < 6; j++) buf[o + j + bytePos] = Number((instruction >> BigInt(8 * j)) & 0xffn);
      }
    }
  }
  return i;
}

function arm(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if (buf[o + 3] === 0xeb) {
      let src = ((buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o]) >>> 0;
      src = (src << 2) >>> 0;
      let dest = isEncoder ? (nowPos + i + 8 + src) >>> 0 : (src - (nowPos + i + 8)) >>> 0;
      dest >>>= 2;
      buf[o + 2] = dest >>> 16;
      buf[o + 1] = dest >>> 8;
      buf[o] = dest;
    }
  }
  return i;
}

function armthumb(s, nowPos, isEncoder, buf, start, size) {
  if (size < 4) return 0;
  size -= 4;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    if ((buf[o + 1] & 0xf8) === 0xf0 && (buf[o + 3] & 0xf8) === 0xf8) {
      let src = (((buf[o + 1] & 7) << 19) | (buf[o] << 11) | ((buf[o + 3] & 7) << 8) | buf[o + 2]) >>> 0;
      src = (src << 1) >>> 0;
      let dest = isEncoder ? (nowPos + i + 4 + src) >>> 0 : (src - (nowPos + i + 4)) >>> 0;
      dest >>>= 1;
      buf[o + 1] = 0xf0 | ((dest >>> 19) & 0x7);
      buf[o] = dest >>> 11;
      buf[o + 3] = 0xf8 | ((dest >>> 8) & 0x7);
      buf[o + 2] = dest;
      i += 2;
    }
  }
  return i;
}

const rd32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const wr32le = (b, o, v) => { b[o] = v; b[o + 1] = v >>> 8; b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; };
const rd32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const wr32be = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; };

function arm64(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    let pc = (nowPos + i) >>> 0;
    let instr = rd32le(buf, o);
    if ((instr >>> 26) === 0x25) {
      const src = instr;
      instr = 0x94000000;
      pc >>>= 2;
      if (!isEncoder) pc = (0 - pc) >>> 0;
      instr = (instr | ((src + pc) & 0x03ffffff)) >>> 0;
      wr32le(buf, o, instr);
    } else if (((instr & 0x9f000000) >>> 0) === 0x90000000) {
      const src = (((instr >>> 29) & 3) | ((instr >>> 3) & 0x001ffffc)) >>> 0;
      if (((src + 0x00020000) & 0x001c0000) !== 0) continue;
      instr = (instr & 0x9000001f) >>> 0;
      pc >>>= 12;
      if (!isEncoder) pc = (0 - pc) >>> 0;
      const dest = (src + pc) >>> 0;
      instr |= (dest & 3) << 29;
      instr |= (dest & 0x0003fffc) << 3;
      instr |= ((0 - (dest & 0x00020000)) >>> 0) & 0x00e00000;
      wr32le(buf, o, instr >>> 0);
    }
  }
  return i;
}

function sparc(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if ((buf[o] === 0x40 && (buf[o + 1] & 0xc0) === 0x00) || (buf[o] === 0x7f && (buf[o + 1] & 0xc0) === 0xc0)) {
      let src = rd32be(buf, o);
      src = (src << 2) >>> 0;
      let dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
      dest >>>= 2;
      dest = ((((0 - ((dest >>> 22) & 1)) << 22) & 0x3fffffff) | (dest & 0x3fffff) | 0x40000000) >>> 0;
      wr32be(buf, o, dest);
    }
  }
  return i;
}

const notAuipcPair = (auipc, inst2) => ((((auipc << 8) ^ ((inst2 - 3) >>> 0)) & 0xf8003) >>> 0) !== 0;
const notSpecialAuipc = (auipc, rs1) => ((((auipc - 0x3117) << 18) >>> 0) >= (rs1 & 0x1d));
function riscvEncode(s, nowPos, isEncoder, buf, start, size) {
  if (size < 8) return 0;
  size -= 8;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    let inst = buf[o];
    if (inst === 0xef) {
      const b1 = buf[o + 1];
      if ((b1 & 0x0d) !== 0) continue;
      const b2 = buf[o + 2], b3 = buf[o + 3];
      const pc = (nowPos + i) >>> 0;
      let addr = ((b1 & 0xf0) << 8) | ((b2 & 0x0f) << 16) | ((b2 & 0x10) << 7) | ((b2 & 0xe0) >>> 4) | ((b3 & 0x7f) << 4) | ((b3 & 0x80) << 13);
      addr = (addr + pc) >>> 0;
      buf[o + 1] = (b1 & 0x0f) | ((addr >>> 13) & 0xf0);
      buf[o + 2] = addr >>> 9;
      buf[o + 3] = addr >>> 1;
      i += 4 - 2;
    } else if ((inst & 0x7f) === 0x17) {
      inst = (inst | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
      if (inst & 0xe80) {
        const inst2 = rd32le(buf, o + 4);
        if (notAuipcPair(inst, inst2)) { i += 6 - 2; continue; }
        let addr = (inst & 0xfffff000) >>> 0;
        addr = (addr + (inst2 >>> 20) - ((inst2 >>> 19) & 0x1000)) >>> 0;
        addr = (addr + nowPos + i) >>> 0;
        inst = (0x17 | (2 << 7) | (inst2 << 12)) >>> 0;
        wr32le(buf, o, inst);
        wr32be(buf, o + 4, addr);
      } else {
        const fakeRs1 = inst >>> 27;
        if (notSpecialAuipc(inst, fakeRs1)) { i += 4 - 2; continue; }
        const fakeAddr = rd32le(buf, o + 4);
        const fakeInst2 = ((inst >>> 12) | (fakeAddr << 20)) >>> 0;
        inst = (0x17 | (fakeRs1 << 7) | (fakeAddr & 0xfffff000)) >>> 0;
        wr32le(buf, o, inst);
        wr32le(buf, o + 4, fakeInst2);
      }
      i += 8 - 2;
    }
  }
  return i;
}
function riscvDecode(s, nowPos, isEncoder, buf, start, size) {
  if (size < 8) return 0;
  size -= 8;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    let inst = buf[o];
    if (inst === 0xef) {
      const b1 = buf[o + 1];
      if ((b1 & 0x0d) !== 0) continue;
      const b2 = buf[o + 2], b3 = buf[o + 3];
      const pc = (nowPos + i) >>> 0;
      let addr = (((b1 & 0xf0) << 13) | (b2 << 9) | (b3 << 1)) >>> 0;
      addr = (addr - pc) >>> 0;
      buf[o + 1] = (b1 & 0x0f) | ((addr >>> 8) & 0xf0);
      buf[o + 2] = ((addr >>> 16) & 0x0f) | ((addr >>> 7) & 0x10) | ((addr << 4) & 0xe0);
      buf[o + 3] = ((addr >>> 4) & 0x7f) | ((addr >>> 13) & 0x80);
      i += 4 - 2;
    } else if ((inst & 0x7f) === 0x17) {
      let inst2;
      inst = (inst | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
      if (inst & 0xe80) {
        inst2 = rd32le(buf, o + 4);
        if (notAuipcPair(inst, inst2)) { i += 6 - 2; continue; }
        let addr = (inst & 0xfffff000) >>> 0;
        addr = (addr + (inst2 >>> 20)) >>> 0;
        inst = (0x17 | (2 << 7) | (inst2 << 12)) >>> 0;
        inst2 = addr;
      } else {
        const rs1 = inst >>> 27;
        if (notSpecialAuipc(inst, rs1)) { i += 4 - 2; continue; }
        let addr = rd32be(buf, o + 4);
        addr = (addr - (nowPos + i)) >>> 0;
        inst2 = ((inst >>> 12) | (addr << 20)) >>> 0;
        inst = (0x17 | (rs1 << 7) | ((addr + 0x800) & 0xfffff000)) >>> 0;
      }
      wr32le(buf, o, inst);
      wr32le(buf, o + 4, inst2);
      i += 8 - 2;
    }
  }
  return i;
}

// the filter IDs of the format
const FILTER_DELTA = 0x03, FILTER_X86 = 0x04, FILTER_POWERPC = 0x05, FILTER_IA64 = 0x06,
  FILTER_ARM = 0x07, FILTER_ARMTHUMB = 0x08, FILTER_SPARC = 0x09, FILTER_ARM64 = 0x0a, FILTER_RISCV = 0x0b,
  FILTER_LZMA1 = 0x4000000000000001n, FILTER_LZMA2 = 0x21;

// id → [kernel (or [enc, dec]), unfilteredMax, alignment]
const BCJ = {
  [FILTER_X86]: [x86, 5, 1], [FILTER_POWERPC]: [powerpc, 4, 4], [FILTER_IA64]: [ia64, 16, 16],
  [FILTER_ARM]: [arm, 4, 4], [FILTER_ARMTHUMB]: [armthumb, 4, 2], [FILTER_ARM64]: [arm64, 4, 4],
  [FILTER_SPARC]: [sparc, 4, 4], [FILTER_RISCV]: [[riscvEncode, riscvDecode], 8, 2],
};
const isBcj = (id) => Object.hasOwn(BCJ, id);

// a coder for filter {id, options} over next
function makeFilterCoder(f, next, isEncoder) {
  if (f.id === FILTER_DELTA) return new DeltaCoder(next, f.dist ?? 1, isEncoder);
  const spec = BCJ[f.id];
  if (!spec) throw new RangeError(`lzma: unsupported filter ${f.id}`);
  const [k, unfilteredMax, alignment] = spec;
  const kernel = Array.isArray(k) ? (isEncoder ? k[0] : k[1]) : k;
  const state = f.id === FILTER_X86 ? { prevMask: 0, prevPos: (-5) >>> 0 } : null;
  return new SimpleCoder(next, kernel, unfilteredMax, alignment, isEncoder, f.start_offset ?? 0, state);
}

// ── src/encoder.js ──

// Encoders over a filter chain, in the three formats CPython's lzma writes: .xz (stream_encoder.c,
// block_encoder.c, block_header_encoder.c, index_encoder.c, stream_flags_encoder.c), .lzma
// (alone_encoder.c) and raw (filter_encoder.c) — liblzma 5.8.1's, ported, so the bytes are its.
// The output only grows: every coder below resumes where it stopped when it filled it.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const FINISH$encoder = 3;
const PRESET_DEFAULT = 6, PRESET_EXTREME = 0x80000000;

class LzmaError extends Error {
  constructor(message) { super(message); this.name = 'LzmaError'; }
}
const OPTIONS_ERROR = 'Invalid or unsupported options';

// lzma_lzma_preset: the LZMA options of a preset 0..9 (| PRESET_EXTREME)
function presetOptions(preset) {
  const level = preset & 0x1f, flags = (preset & ~0x1f) >>> 0;
  if (level > 9 || (flags & ~PRESET_EXTREME)) throw new LzmaError(`Invalid compression preset: ${preset >>> 0}`);
  const dictPow2 = [18, 20, 21, 22, 22, 23, 23, 24, 25, 26];
  const o = { lc: 3, lp: 0, pb: 2, dictSize: 2 ** dictPow2[level] };
  if (level <= 3) {
    o.mode = 'fast';
    o.mf = level === 0 ? MF_HC3 : MF_HC4;
    o.niceLen = level <= 1 ? 128 : 273;
    o.depth = [4, 8, 24, 48][level];
  } else {
    o.mode = 'normal';
    o.mf = MF_BT4;
    o.niceLen = level === 4 ? 16 : level === 5 ? 32 : 64;
    o.depth = 0;
  }
  if (flags & PRESET_EXTREME) {
    o.mode = 'normal';
    o.mf = MF_BT4;
    if (level === 3 || level === 5) { o.niceLen = 192; o.depth = 0; } else { o.niceLen = 273; o.depth = 512; }
  }
  return o;
}

// a filter's property bytes (lzma_properties_encode)
function filterProps(f) {
  if (f.id === FILTER_LZMA2) return Uint8Array.of(lzma2Props(f.dictSize));
  if (f.id === FILTER_LZMA1) return lzma1Props(f);
  if (f.id === FILTER_DELTA) {
    const dist = f.dist ?? 1;
    if (!(dist >= 1 && dist <= 256)) throw new LzmaError(OPTIONS_ERROR);
    return Uint8Array.of(dist - 1);
  }
  if (isBcj(f.id)) {
    const s = f.start_offset ?? 0;
    return s === 0 ? new Uint8Array(0) : Uint8Array.of(s, s >>> 8, s >>> 16, s >>> 24);
  }
  throw new LzmaError(OPTIONS_ERROR);
}

// lzma_validate_chain: 1..4 filters, the last (and only the last) LZMA1 / LZMA2
function validateChain(filters) {
  if (!filters.length || filters.length > 4) throw new LzmaError(OPTIONS_ERROR);
  filters.forEach((f, i) => {
    const isLz = f.id === FILTER_LZMA1 || f.id === FILTER_LZMA2;
    const known = isLz || f.id === FILTER_DELTA || isBcj(f.id);
    if (!known || isLz !== (i === filters.length - 1)) throw new LzmaError(OPTIONS_ERROR);
  });
}

function vliEncode(v, out) {
  let n = BigInt(v);
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) b |= 0x80;
    out.push(b);
  } while (n !== 0n);
}
const vliSize = (v) => { const a = []; vliEncode(v, a); return a.length; };

// the growing output
class Out$encoder {
  constructor() { this.buf = new Uint8Array(1 << 16); this.pos = 0; this.size = this.buf.length; }
  grow() {
    const b = new Uint8Array(this.buf.length * 2);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b; this.size = b.length;
  }
  push(bytes) { while (this.pos + bytes.length > this.size) this.grow(); this.buf.set(bytes, this.pos); this.pos += bytes.length; }
  take() { const r = this.buf.slice(0, this.pos); this.pos = 0; return r; }
}

// ── the raw encoder: the filters, then LZMA1 / LZMA2 over the window (lz_encode) ──
class RawEncoder {
  constructor(filters) {
    validateChain(filters);
    this.input = new InputSource();
    let src = this.input;
    for (let i = 0; i < filters.length - 1; i++) src = makeFilterCoder(filters[i], src, true);
    this.source = src;
    const last = filters[filters.length - 1];
    const o = lzmaOptions(last);
    if (last.id === FILTER_LZMA2) {
      this.lz = new Lzma2Encoder(o);
      this.mf = this.lz.mf;
    } else {
      const lzma = new LzmaEncoder(o, { isLzma1: true });
      this.mf = new MatchFinder(LzmaEncoder.lzOptions(o));
      const mf = this.mf;
      this.lz = { code: (out) => lzma.encode(mf, out, 0xffffffff) };
    }
    this.action = RUN$lz_encoder;
  }
  // feed data (consumed as it goes); 'end' once FINISH has been encoded to the end
  code(data, out, action) {
    this.input.data = data;
    this.input.pos = 0;
    const mf = this.mf;
    const produce = (buf, writePos, size) => this.source.code(buf, writePos, size, action);
    while (true) {
      while (out.pos < out.size && (this.input.pos < this.input.data.length || action !== RUN$lz_encoder)) {
        if (mf.action === RUN$lz_encoder && mf.readPos >= mf.readLimit) mf.fill(produce, action);
        const ret = this.lz.code(out);
        if (ret !== 'ok') { mf.action = RUN$lz_encoder; return ret; }
      }
      if (out.pos < out.size) return 'ok';   // the input is used up
      out.grow();
    }
  }
}

// the LZMA options of an LZMA1 / LZMA2 filter spec (a preset, with the spec's fields over it)
function lzmaOptions(f) {
  const o = presetOptions(f.preset ?? PRESET_DEFAULT);
  for (const k of ['dictSize', 'lc', 'lp', 'pb', 'mode', 'niceLen', 'mf', 'depth']) if (f[k] !== undefined && f[k] !== null) o[k] = f[k];
  if (!(o.dictSize >= 4096 && o.dictSize <= (1 << 30) + (1 << 29))) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.lc <= 4 && o.lp <= 4 && o.lc + o.lp <= 4 && o.pb <= 4)) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.niceLen >= 2 && o.niceLen <= 273) || !['fast', 'normal'].includes(o.mode)) throw new LzmaError(OPTIONS_ERROR);
  if (![0x03, 0x04, 0x12, 0x13, 0x14].includes(o.mf)) throw new LzmaError(OPTIONS_ERROR);
  return o;
}

// ── raw: the filter chain's output, nothing around it ──
class RawStreamEncoder {
  constructor(filters) { this.raw = new RawEncoder(filters); this.out = new Out$encoder(); }
  compress(data) { this.raw.code(data, this.out, RUN$lz_encoder); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH$encoder); return this.out.take(); }
}

// ── .lzma (LZMA_Alone): 13-byte header (props, dictionary size rounded up, size unknown) ──
class AloneEncoder {
  constructor(lzmaFilter) {
    const o = lzmaOptions(lzmaFilter);
    let d = o.dictSize - 1;
    d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
    d >>>= 0;
    if (d !== 0xffffffff) ++d;
    const header = new Uint8Array(13);
    header.set(lzma1Props({ ...o, dictSize: 0 }).subarray(0, 1));
    header[1] = d; header[2] = d >>> 8; header[3] = d >>> 16; header[4] = d >>> 24;
    header.fill(0xff, 5);
    this.raw = new RawEncoder([{ ...lzmaFilter, id: FILTER_LZMA1 }]);
    this.out = new Out$encoder();
    this.out.push(header);
  }
  compress(data) { this.raw.code(data, this.out, RUN$lz_encoder); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH$encoder); return this.out.take(); }
}

// ── .xz ──
const HEADER_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const FOOTER_MAGIC = [0x59, 0x5a];

function streamFlags(check) { return [0x00, check]; }
function le32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

function streamHeader(check) {
  const flags = streamFlags(check);
  return Uint8Array.from([...HEADER_MAGIC, ...flags, ...le32(crc32(Uint8Array.from(flags)))]);
}

// lzma_block_header_size + lzma_block_header_encode (sizes unknown, as the stream encoder writes)
function blockHeader(filters) {
  const ff = [];
  for (const f of filters) {
    const props = filterProps(f);
    vliEncode(f.id, ff);
    vliEncode(props.length, ff);
    ff.push(...props);
  }
  const size = 1 + 1 + 4 + ff.length;
  const headerSize = (size + 3) & ~3;
  const out = new Uint8Array(headerSize);
  out[0] = (headerSize - 4) / 4;
  out[1] = filters.length - 1;
  out.set(ff, 2);
  const crc = crc32(out, 0, 0, headerSize - 4);
  out.set(le32(crc), headerSize - 4);
  return out;
}

function indexAndFooter(records, check) {
  const idx = [0x00];
  vliEncode(records.length, idx);
  for (const r of records) { vliEncode(r.unpadded, idx); vliEncode(r.uncompressed, idx); }
  while ((idx.length + 4) & 3) idx.push(0);
  const index = Uint8Array.from(idx);
  const indexFull = new Uint8Array(index.length + 4);
  indexFull.set(index);
  indexFull.set(le32(crc32(index)), index.length);
  const backward = indexFull.length / 4 - 1;
  const ft = [...le32(backward), ...streamFlags(check)];
  const footer = Uint8Array.from([...le32(crc32(Uint8Array.from(ft))), ...ft, ...FOOTER_MAGIC]);
  return [indexFull, footer];
}

class XzEncoder {
  // filters: the chain (last LZMA2); check: 0 none, 1 CRC32, 4 CRC64, 10 SHA-256
  constructor(filters, check) {
    if (!(check >= 0 && check <= CHECK_ID_MAX)) throw new LzmaError('Invalid or unsupported options');
    if (!isCheckSupported(check)) throw new LzmaError('Unsupported integrity check');
    validateChain(filters);
    if (filters[filters.length - 1].id !== FILTER_LZMA2) throw new LzmaError(OPTIONS_ERROR);
    this.filters = filters.map((f) => (f.id === FILTER_LZMA2 ? { ...f, ...lzmaOptions(f) } : f));
    this.check = check;
    this.out = new Out$encoder();
    this.out.push(streamHeader(check));
    this.records = [];
    this.block = null;   // the open block: { raw, check, compressed, uncompressed, headerSize }
  }
  _openBlock() {
    const header = blockHeader(this.filters);
    this.out.push(header);
    this.block = { raw: new RawEncoder(this.filters), check: new Check(this.check), compressed: 0, uncompressed: 0, headerSize: header.length };
  }
  _code(data, action) {
    const b = this.block;
    const start = this.out.pos;
    const ret = b.raw.code(data, this.out, action);
    b.compressed += this.out.pos - start;
    b.uncompressed += data.length;
    if (data.length) b.check.update(data);
    return ret;
  }
  compress(data) {
    // (stream_encode's SEQ_BLOCK_INIT: a block starts when there is input)
    if (data.length) {
      if (!this.block) this._openBlock();
      this._code(data, RUN$lz_encoder);
    }
    return this.out.take();
  }
  flush() {
    if (this.block) {
      this._code(new Uint8Array(0), FINISH$encoder);
      const b = this.block;
      // (the block's compressed size is the data's: the index records it before the padding)
      this.records.push({ unpadded: b.headerSize + b.compressed + checkSize(this.check), uncompressed: b.uncompressed });
      for (let c = b.compressed; c & 3; ++c) this.out.push(Uint8Array.of(0));
      this.out.push(b.check.finish());
      this.block = null;
    }
    const [index, footer] = indexAndFooter(this.records, this.check);
    this.out.push(index);
    this.out.push(footer);
    return this.out.take();
  }
}

// ── src/lzma-decoder.js ──

// The LZMA and LZMA2 decoders (lzma_decoder.c, lzma2_decoder.c, lz_decoder.c of liblzma 5.8.1,
// in effect): the format as liblzma reads it, with its checks — the range coder's first byte
// zero, an end that leaves it finished, distances inside the dictionary, LZMA2's chunk sizes
// exact.
//
// The input may stop anywhere, even inside a symbol; liblzma saves its place bit by bit. Here a
// symbol is decoded straight through when enough input is at hand (a symbol needs at most 21
// bytes), and with an undo log when not: if the input runs out inside it, the symbol is undone
// and tried again with more. Input taken into a symbol counts as consumed either way, as liblzma's
// range decoder has taken it — so needs_input and unused_data come out as CPython's.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

const RC_TOP_VALUE$lzma_decoder = 1 << 24, RC_BIT_MODEL_TOTAL_BITS$lzma_decoder = 11, RC_BIT_MODEL_TOTAL$lzma_decoder = 1 << 11, RC_MOVE_BITS$lzma_decoder = 5;
const STATES$lzma_decoder = 12, LIT_STATES$lzma_decoder = 7, POS_STATES_MAX$lzma_decoder = 16;
const LITERAL_CODER_SIZE$lzma_decoder = 0x300, LITERAL_CODERS_MAX$lzma_decoder = 16;
const MATCH_LEN_MIN$lzma_decoder = 2;
const LEN_LOW_SYMBOLS$lzma_decoder = 8, LEN_MID_SYMBOLS$lzma_decoder = 8, LEN_HIGH_SYMBOLS$lzma_decoder = 256;
const DIST_STATES$lzma_decoder = 4, DIST_SLOTS$lzma_decoder = 64, DIST_MODEL_START$lzma_decoder = 4, DIST_MODEL_END$lzma_decoder = 14, FULL_DISTANCES$lzma_decoder = 128;
const ALIGN_BITS$lzma_decoder = 4, ALIGN_SIZE$lzma_decoder = 16;
const LC_CHOICE$lzma_decoder = 0, LC_CHOICE2$lzma_decoder = 1, LC_LOW$lzma_decoder = 2, LC_MID$lzma_decoder = LC_LOW$lzma_decoder + POS_STATES_MAX$lzma_decoder * LEN_LOW_SYMBOLS$lzma_decoder, LC_HIGH$lzma_decoder = LC_MID$lzma_decoder + POS_STATES_MAX$lzma_decoder * LEN_MID_SYMBOLS$lzma_decoder;
const LC_SIZE = LC_HIGH$lzma_decoder + LEN_HIGH_SYMBOLS$lzma_decoder;
const IN_REQUIRED = 21;
const UINT32_MAX$lzma_decoder = 0xffffffff;

class LzmaDataError extends Error {
  constructor(msg = 'Corrupt input data') { super(msg); this.name = 'LzmaDataError'; }
}
const NEED = { need: true };   // thrown when a symbol runs out of input (undone, retried later)

const updateLiteral$lzma_decoder = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);

// the input: buf[pos .. end); `final` — no more will come
class InputBuffer {
  constructor() { this.buf = new Uint8Array(0); this.pos = 0; this.end = 0; }
  avail() { return this.end - this.pos; }
}

// the dictionary: a window of the last `size` bytes out, growing to that size as output comes
class Dict {
  constructor(size) {
    this.size = size;
    this.buf = new Uint8Array(Math.min(size, 1 << 16));
    this.pos = 0;     // next write (wraps once buf has reached size)
    this.full = 0;    // bytes valid since the last reset (≤ size)
    this.total = 0;   // bytes since the last reset, mod 2^32 (the position LZMA's contexts see)
  }
  reset() { this.pos = 0; this.full = 0; this.total = 0; }
  put(b) {
    if (this.pos === this.buf.length) {
      if (this.buf.length < this.size) {
        const nb = new Uint8Array(Math.min(this.size, this.buf.length * 2));
        nb.set(this.buf);
        this.buf = nb;
      } else this.pos = 0;
    }
    this.buf[this.pos++] = b;
    if (this.full < this.size) ++this.full;
    this.total = (this.total + 1) >>> 0;
  }
  // the byte `dist` + 1 back
  get(dist) {
    let i = this.pos - dist - 1;
    if (i < 0) i += this.buf.length;
    return this.buf[i];
  }
}

// one LZMA coder's state: probabilities, state, reps, range decoder; output into a Dict and out
class LzmaCore {
  constructor(dictSize) {
    this.dict = new Dict(dictSize);
    this.literal = new Uint16Array(LITERAL_CODERS_MAX$lzma_decoder * LITERAL_CODER_SIZE$lzma_decoder);
    this.isMatch = new Uint16Array(STATES$lzma_decoder * POS_STATES_MAX$lzma_decoder);
    this.isRep = new Uint16Array(STATES$lzma_decoder);
    this.isRep0 = new Uint16Array(STATES$lzma_decoder);
    this.isRep1 = new Uint16Array(STATES$lzma_decoder);
    this.isRep2 = new Uint16Array(STATES$lzma_decoder);
    this.isRep0Long = new Uint16Array(STATES$lzma_decoder * POS_STATES_MAX$lzma_decoder);
    this.distSlot = new Uint16Array(DIST_STATES$lzma_decoder * DIST_SLOTS$lzma_decoder);
    this.distSpecial = new Uint16Array(FULL_DISTANCES$lzma_decoder - DIST_MODEL_END$lzma_decoder);
    this.distAlign = new Uint16Array(ALIGN_SIZE$lzma_decoder);
    this.matchLen = new Uint16Array(LC_SIZE);
    this.repLen = new Uint16Array(LC_SIZE);
    this.reps = [0, 0, 0, 0];
    this.state = 0;
    this.range = 0; this.code = 0; this.initLeft = 5;
    this.pendingLen = 0;   // a match cut short by the output's end: what remains of it
    this.log = null;       // the undo log, while a symbol may run out of input
  }

  // lzma_decoder_reset
  resetState(lc, lp, pb) {
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.posMask = (1 << pb) - 1;
    this.literalMask = ((0x100 << lp) - (0x100 >>> lc)) >>> 0;
    const half = RC_BIT_MODEL_TOTAL$lzma_decoder >>> 1;
    for (const a of [this.literal, this.isMatch, this.isRep, this.isRep0, this.isRep1, this.isRep2, this.isRep0Long,
      this.distSlot, this.distSpecial, this.distAlign, this.matchLen, this.repLen]) a.fill(half);
    this.reps = [0, 0, 0, 0];
    this.state = 0;
    this.pendingLen = 0;
    this.rcReset();
  }
  rcReset() { this.range = UINT32_MAX$lzma_decoder; this.code = 0; this.initLeft = 5; }

  // rc_read_init: the first 5 bytes (the first one zero); false while input is short
  rcInit(inp) {
    while (this.initLeft > 0) {
      if (inp.pos === inp.end) return false;
      if (this.initLeft === 5 && inp.buf[inp.pos] !== 0x00) throw new LzmaDataError();
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
      --this.initLeft;
    }
    return true;
  }

  _normalize(inp) {
    if (this.range < RC_TOP_VALUE$lzma_decoder) {
      if (inp.pos === inp.end) throw NEED;
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
    }
  }
  _bit(inp, arr, idx) {
    this._normalize(inp);
    const prob = arr[idx];
    const bound = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_decoder, prob) >>> 0;
    if (this.log) this.log.push(arr, idx, prob);
    if (this.code < bound) {
      this.range = bound;
      arr[idx] = prob + ((RC_BIT_MODEL_TOTAL$lzma_decoder - prob) >>> RC_MOVE_BITS$lzma_decoder);
      return 0;
    }
    this.range = (this.range - bound) >>> 0;
    this.code = (this.code - bound) >>> 0;
    arr[idx] = prob - (prob >>> RC_MOVE_BITS$lzma_decoder);
    return 1;
  }
  _bittree(inp, arr, base, bits) {
    let symbol = 1;
    for (let i = 0; i < bits; i++) symbol = (symbol << 1) | this._bit(inp, arr, base + symbol);
    return symbol - (1 << bits);
  }
  _bittreeReverse(inp, arr, base, bits) {
    let symbol = 1, result = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this._bit(inp, arr, base + symbol);
      symbol = (symbol << 1) | bit;
      result |= bit << i;
    }
    return result;
  }
  _direct(inp, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      this._normalize(inp);
      this.range >>>= 1;
      const t = this.code >= this.range ? 1 : 0;
      if (t) this.code = (this.code - this.range) >>> 0;
      result = ((result << 1) | t) >>> 0;
    }
    return result;
  }
  _len(inp, lc, posState) {
    if (this._bit(inp, lc, LC_CHOICE$lzma_decoder) === 0) return MATCH_LEN_MIN$lzma_decoder + this._bittree(inp, lc, LC_LOW$lzma_decoder + posState * LEN_LOW_SYMBOLS$lzma_decoder, 3);
    if (this._bit(inp, lc, LC_CHOICE2$lzma_decoder) === 0) return MATCH_LEN_MIN$lzma_decoder + LEN_LOW_SYMBOLS$lzma_decoder + this._bittree(inp, lc, LC_MID$lzma_decoder + posState * LEN_MID_SYMBOLS$lzma_decoder, 3);
    return MATCH_LEN_MIN$lzma_decoder + LEN_LOW_SYMBOLS$lzma_decoder + LEN_MID_SYMBOLS$lzma_decoder + this._bittree(inp, lc, LC_HIGH$lzma_decoder, 8);
  }

  // copy what a match still has to give into the dictionary and out
  _copy(out) {
    const d = this.dict, dist = this.reps[0];
    let n = Math.min(this.pendingLen, out.end - out.pos);
    this.pendingLen -= n;
    while (n-- > 0) {
      const b = d.get(dist);
      d.put(b);
      out.buf[out.pos++] = b;
    }
  }

  // decode symbols into out until: out is full ('out'), `limit` bytes have come out ('limit' —
  // LZMA2's chunk size, LZMA1's known size; Infinity for none), the end marker ('eopm'), or the
  // input runs out ('input'). allowEopm: an end marker may come (it is an error else)
  decode(inp, out, limit, allowEopm) {
    if (this.afterEopm) return this._eopmFinish(inp);
    if (this.pendingLen) {
      const before = out.pos;
      this._copy(out);
      limit -= out.pos - before;
      if (this.pendingLen) return { why: 'out', produced: out.pos - before };
    }
    const start = out.pos;
    const d = this.dict;
    let produced = 0;
    while (true) {
      if (produced >= limit) return { why: 'limit', produced };
      if (out.pos === out.end) return { why: 'out', produced };
      // a symbol: straight through with input to spare, else with an undo log
      const careful = inp.end - inp.pos < IN_REQUIRED;
      const snap = careful ? this._snapshot(inp, out) : null;
      try {
        const r = this._symbol(inp, out, allowEopm);
        if (careful) this.log = null;
        if (r === 'eopm') { this.afterEopm = true; return this._eopmFinish(inp); }
      } catch (e) {
        if (e !== NEED) throw e;
        this._undo(snap, inp, out);
        return { why: 'input', produced: out.pos - start };
      }
      produced = out.pos - start;
      if (produced > limit) throw new LzmaDataError();
    }
  }

  // after the end marker: one more normalization, and the range decoder finished (SEQ_EOPM)
  _eopmFinish(inp) {
    const f = this.finishCheck(inp);
    if (f === 'input') return { why: 'input', produced: 0 };
    if (f === false) throw new LzmaDataError();
    this.afterEopm = false;
    return { why: 'eopm', produced: 0 };
  }

  _snapshot(inp, out) {
    this.log = [];
    const d = this.dict;
    return { range: this.range, code: this.code, state: this.state, reps: this.reps.slice(), pendingLen: this.pendingLen,
      inPos: inp.pos, outPos: out.pos, dpos: d.pos, dfull: d.full, dtotal: d.total, dlen: d.buf.length };
  }
  _undo(s, inp, out) {
    const log = this.log;
    for (let i = log.length - 3; i >= 0; i -= 3) log[i][log[i + 1]] = log[i + 2];
    this.log = null;
    this.range = s.range; this.code = s.code; this.state = s.state; this.reps = s.reps; this.pendingLen = s.pendingLen;
    // (the input taken stays taken: it is kept, and the symbol re-read from it — see decode's
    // caller, which carries the bytes from snapshot.inPos over)
    inp.pos = s.inPos;
    out.pos = s.outPos;
    const d = this.dict;
    d.pos = s.dpos; d.full = s.dfull; d.total = s.dtotal;
  }

  _symbol(inp, out, allowEopm) {
    const d = this.dict;
    const posState = d.total & this.posMask;
    const state = this.state;
    if (this._bit(inp, this.isMatch, state * POS_STATES_MAX$lzma_decoder + posState) === 0) {
      // a literal
      const prev = d.full ? d.get(0) : 0;
      const sub = 3 * ((((((d.total << 8) + prev) >>> 0) & this.literalMask) << this.lc) >>> 0);
      let symbol;
      if (state < LIT_STATES$lzma_decoder) {
        symbol = 1;
        do symbol = (symbol << 1) | this._bit(inp, this.literal, sub + symbol); while (symbol < 0x100);
      } else {
        let matchByte = d.get(this.reps[0]);
        let offset = 0x100;
        symbol = 1;
        do {
          matchByte <<= 1;
          const matchBit = matchByte & offset;
          const bit = this._bit(inp, this.literal, sub + offset + matchBit + symbol);
          symbol = (symbol << 1) | bit;
          offset &= bit ? matchBit : ~matchBit;
        } while (symbol < 0x100);
      }
      this.state = updateLiteral$lzma_decoder(state);
      this._putByte(symbol & 0xff, out);
      return 'lit';
    }
    let len;
    if (this._bit(inp, this.isRep, state) === 0) {
      // a match: length, then distance
      len = this._len(inp, this.matchLen, posState);
      const distState = len < DIST_STATES$lzma_decoder + MATCH_LEN_MIN$lzma_decoder ? len - MATCH_LEN_MIN$lzma_decoder : DIST_STATES$lzma_decoder - 1;
      const slot = this._bittree(inp, this.distSlot, distState * DIST_SLOTS$lzma_decoder, 6);
      let dist;
      if (slot < DIST_MODEL_START$lzma_decoder) {
        dist = slot;
      } else {
        const limit = (slot >>> 1) - 1;
        dist = ((2 | (slot & 1)) << limit) >>> 0;
        if (slot < DIST_MODEL_END$lzma_decoder) {
          dist = (dist + this._bittreeReverse(inp, this.distSpecial, dist - slot - 1, limit)) >>> 0;
        } else {
          dist = (dist + ((this._direct(inp, limit - ALIGN_BITS$lzma_decoder) << ALIGN_BITS$lzma_decoder) >>> 0)) >>> 0;
          dist = (dist + this._bittreeReverse(inp, this.distAlign, 0, ALIGN_BITS$lzma_decoder)) >>> 0;
          if (dist === UINT32_MAX$lzma_decoder) {
            if (!allowEopm) throw new LzmaDataError();
            return 'eopm';
          }
        }
      }
      if (dist >= d.full) throw new LzmaDataError();
      this.reps = [dist, this.reps[0], this.reps[1], this.reps[2]];
      this.state = state < LIT_STATES$lzma_decoder ? 7 : 10;
    } else {
      if (d.full === 0) throw new LzmaDataError();
      if (this._bit(inp, this.isRep0, state) === 0) {
        if (this._bit(inp, this.isRep0Long, state * POS_STATES_MAX$lzma_decoder + posState) === 0) {
          // a short rep: one byte from rep0
          this.state = state < LIT_STATES$lzma_decoder ? 9 : 11;
          this._putByte(d.get(this.reps[0]), out);
          return 'shortrep';
        }
      } else {
        let dist;
        if (this._bit(inp, this.isRep1, state) === 0) {
          dist = this.reps[1];
          this.reps = [dist, this.reps[0], this.reps[2], this.reps[3]];
        } else if (this._bit(inp, this.isRep2, state) === 0) {
          dist = this.reps[2];
          this.reps = [dist, this.reps[0], this.reps[1], this.reps[3]];
        } else {
          dist = this.reps[3];
          this.reps = [dist, this.reps[0], this.reps[1], this.reps[2]];
        }
      }
      len = this._len(inp, this.repLen, posState);
      this.state = state < LIT_STATES$lzma_decoder ? 8 : 11;
    }
    this.pendingLen = len;
    this._copy(out);
    return 'match';
  }

  // (a symbol writes only once all its bits are read: one cut short has written nothing)
  _putByte(b, out) {
    const d = this.dict;
    d.put(b);
    out.buf[out.pos++] = b;
  }

  // at a known end (LZMA2's chunk, LZMA1's size): is the range decoder finished — after the one
  // normalization that may still be due? true / false, or 'input' when that byte isn't here yet
  finishCheck(inp) {
    if (this.range < RC_TOP_VALUE$lzma_decoder) {
      if (inp.pos === inp.end) return 'input';
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
    }
    return this.code === 0;
  }

  // the end marker, where one must come (LZMA1 with its size reached, the coder unfinished):
  // 'eopm', or 'input' (undone, to retry); any other symbol is an error
  expectEopm(inp) {
    if (this.afterEopm) return this._eopmFinish(inp).why;
    const snap = this._snapshot(inp, { pos: 0 });
    try {
      const r = this._symbol(inp, { buf: new Uint8Array(LEN_HIGH_SYMBOLS$lzma_decoder + 32), pos: 0, end: 1 }, true);
      this.log = null;
      if (r !== 'eopm') throw new LzmaDataError();
      this.afterEopm = true;
      return this._eopmFinish(inp).why;
    } catch (e) {
      if (e !== NEED) { this.log = null; throw e; }
      this._undo(snap, inp, { pos: 0 });
      return 'input';
    }
  }
}

// lclppb byte → [lc, lp, pb] (lzma_lzma_lclppb_decode)
function lclppbDecode(byte) {
  if (byte > (4 * 5 + 4) * 9 + 8) return null;
  const pb = Math.floor(byte / (9 * 5));
  byte -= pb * 9 * 5;
  const lp = Math.floor(byte / 9);
  const lc = byte - lp * 9;
  if (lc + lp > 4) return null;
  return [lc, lp, pb];
}

function lzma2DictSize(prop) {
  if (prop & 0xc0 || prop > 40) return null;
  if (prop === 40) return UINT32_MAX$lzma_decoder;
  return ((2 | (prop & 1)) * 2 ** (prop / 2 + 11 | 0)) >>> 0;
}

// ── src/decoder.js ──

// Decoders: LZMA2 chunks and LZMA1 over LzmaCore, the filter chain over them, and the formats
// CPython's lzma reads — .xz (stream_decoder.c, block_decoder.c, block_header_decoder.c,
// index_hash.c, stream_flags_decoder.c), .lzma (alone_decoder.c), raw, and auto (the first byte
// tells .xz from .lzma) — each with CPython's LZMADecompressor face: decompress(data, maxLength),
// eof, needsInput, unusedData, check.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const CHECK_UNKNOWN = 16;
const FORMAT_ERROR = 'Input format not supported by decoder';
const DATA_ERROR = 'Corrupt input data';
const MEMLIMIT_ERROR = 'Memory usage limit exceeded';

// ── LZMA2 (lzma2_decoder.c): chunks, each LZMA or stored, with resets ──
const C_CONTROL = 0, C_UNC1 = 1, C_UNC2 = 2, C_COMP0 = 3, C_COMP1 = 4, C_PROPS = 5, C_LZMA = 6, C_COPY = 7, C_END = 8;
class Lzma2Source {
  constructor(inp, dictSize) {
    this.inp = inp;
    this.core = new LzmaCore(dictSize);
    this.seq = C_CONTROL;
    this.needProperties = true;
    this.needDictionaryReset = true;
    this.unc = 0; this.comp = 0; this.next = 0;
  }
  code(out, outPos, outSize) {
    const inp = this.inp, core = this.core;
    const o = { buf: out, pos: outPos, end: outSize };
    while (true) {
      if (this.seq === C_END) return { pos: o.pos, end: true };
      if (this.seq !== C_LZMA && this.seq !== C_COPY && inp.pos === inp.end) return { pos: o.pos, end: false };
      switch (this.seq) {
        case C_CONTROL: {
          const control = inp.buf[inp.pos++];
          if (control === 0x00) { this.seq = C_END; return { pos: o.pos, end: true }; }
          if (control >= 0xe0 || control === 1) {
            this.needProperties = true;
            this.needDictionaryReset = true;
          } else if (this.needDictionaryReset) {
            throw new LzmaDataError();
          }
          if (control >= 0x80) {
            this.unc = (control & 0x1f) << 16;
            this.seq = C_UNC1;
            if (control >= 0xc0) {
              this.needProperties = false;
              this.next = C_PROPS;
            } else if (this.needProperties) {
              throw new LzmaDataError();
            } else {
              this.next = C_LZMA;
              if (control >= 0xa0) core.resetState(core.lc, core.lp, core.pb);
              else core.rcReset();
            }
          } else {
            if (control > 2) throw new LzmaDataError();
            this.seq = C_COMP0;
            this.next = C_COPY;
          }
          if (this.needDictionaryReset) {
            this.needDictionaryReset = false;
            core.dict.reset();
          }
          break;
        }
        case C_UNC1: this.unc += inp.buf[inp.pos++] << 8; this.seq = C_UNC2; break;
        case C_UNC2: this.unc += inp.buf[inp.pos++] + 1; this.seq = C_COMP0; break;
        case C_COMP0: this.comp = inp.buf[inp.pos++] << 8; this.seq = C_COMP1; break;
        case C_COMP1:
          this.comp += inp.buf[inp.pos++] + 1;
          this.seq = this.next;
          if (this.seq === C_COPY) this.unc = this.comp;
          break;
        case C_PROPS: {
          const p = lclppbDecode(inp.buf[inp.pos++]);
          if (!p) throw new LzmaDataError();
          core.resetState(p[0], p[1], p[2]);
          this.seq = C_LZMA;
          break;
        }
        case C_LZMA: {
          // (the chunk's compressed bytes bound the input: none of the next chunk's is read)
          const end = inp.end, start = inp.pos;
          inp.end = Math.min(end, inp.pos + this.comp);
          const complete = inp.end - inp.pos === this.comp;
          try {
            if (core.initLeft > 0 && !core.rcInit(inp)) { this.comp -= inp.pos - start; return { pos: o.pos, end: false }; }
            if (this.unc > 0) {
              const before = o.pos;
              const r = core.decode(inp, o, this.unc, false);
              this.unc -= o.pos - before;
              if (r.why === 'out') { this.comp -= inp.pos - start; return { pos: o.pos, end: false }; }
              if (r.why === 'input') {
                if (complete) throw new LzmaDataError();
                this.comp -= inp.pos - start;
                return { pos: o.pos, end: false };
              }
              if (r.why === 'eopm') throw new LzmaDataError();
            }
            if (this.unc === 0) {
              const f = core.finishCheck(inp);
              if (f === false) throw new LzmaDataError();
              if (f === 'input') {
                if (complete) throw new LzmaDataError();
                this.comp -= inp.pos - start;
                return { pos: o.pos, end: false };
              }
            }
          } finally { inp.end = end; }
          this.comp -= inp.pos - start;
          if (this.comp !== 0) throw new LzmaDataError();
          this.seq = C_CONTROL;
          break;
        }
        case C_COPY: {
          // a stored chunk: its bytes into the dictionary and out
          const n = Math.min(this.unc, inp.end - inp.pos, o.end - o.pos);
          const d = core.dict;
          for (let i = 0; i < n; i++) { const b = inp.buf[inp.pos++]; d.put(b); o.buf[o.pos++] = b; }
          this.unc -= n;
          if (this.unc !== 0) return { pos: o.pos, end: false };
          this.seq = C_CONTROL;
          break;
        }
      }
    }
  }
}

// ── LZMA1 (.lzma, raw): an end marker, or a known size (then a marker may follow — allowEopm) ──
class Lzma1Source {
  constructor(inp, o, size, allowEopm) {
    this.inp = inp;
    this.core = new LzmaCore(Math.max(o.dictSize, 4096));
    this.core.resetState(o.lc, o.lp, o.pb);
    this.left = size;          // Infinity: unknown — the end marker ends it
    this.allowEopm = allowEopm;
    this.stage = 'data';       // 'data' → 'finish' (the size reached) → 'marker' → 'done'
  }
  code(out, outPos, outSize) {
    const inp = this.inp, core = this.core;
    const o = { buf: out, pos: outPos, end: outSize };
    if (this.stage === 'done') return { pos: o.pos, end: true };
    if (core.initLeft > 0 && !core.rcInit(inp)) return { pos: o.pos, end: false };
    if (this.stage === 'data') {
      if (this.left > 0) {
        const before = o.pos;
        const r = core.decode(inp, o, this.left, this.left === Infinity || this.allowEopm);
        this.left -= o.pos - before;
        if (r.why === 'eopm') { this.stage = 'done'; return { pos: o.pos, end: true }; }
        if (r.why !== 'limit') return { pos: o.pos, end: false };
      }
      this.stage = 'finish';
    }
    if (this.stage === 'finish') {
      const f = core.finishCheck(inp);
      if (f === 'input') return { pos: o.pos, end: false };
      if (f === true) { this.stage = 'done'; return { pos: o.pos, end: true }; }
      if (!this.allowEopm) throw new LzmaDataError();
      this.stage = 'marker';
    }
    if (core.expectEopm(inp) === 'input') return { pos: o.pos, end: false };
    this.stage = 'done';
    return { pos: o.pos, end: true };
  }
}

// the decoder chain for filters (first applied last): the LZ source at the bottom
function decoderChain(filters, inp, lzSource) {
  let src = lzSource;
  for (let i = filters.length - 2; i >= 0; i--) src = makeFilterCoder(filters[i], src, false);
  return src;
}

const memusage = (dictSize) => dictSize + 32768;

// ── the output, grown to maxLength (or without limit) ──
class Out$decoder {
  constructor(max) {
    this.max = max < 0 ? Infinity : max;
    this.buf = new Uint8Array(Math.min(this.max, 1 << 14));
    this.pos = 0;
  }
  room() { return this.buf.length - this.pos; }
  full() { return this.pos >= this.max; }
  grow() {
    const n = Math.min(this.max, Math.max(this.buf.length * 2, 1 << 14));
    if (n <= this.buf.length) return false;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
    return true;
  }
  result() { return this.buf.slice(0, this.pos); }
}

// the CPython-faced decompressor around a `step(out)` that returns 'end' | 'input' | 'out'
class Decompressor$decoder {
  constructor() {
    this.eof = false;
    this.needsInput = true;
    this.unusedData = new Uint8Array(0);
    this.check = CHECK_UNKNOWN;
    this.inp = new InputBuffer();
    this._broken = null;
  }
  decompress(data, maxLength = -1) {
    if (this.eof) throw new Error('lzma: end of stream already reached');
    if (this._broken) throw this._broken;
    const inp = this.inp;
    const rest = inp.buf.subarray(inp.pos, inp.end);
    const b = new Uint8Array(rest.length + data.length);
    b.set(rest); b.set(data, rest.length);
    inp.buf = b; inp.pos = 0; inp.end = b.length;
    const out = new Out$decoder(maxLength);
    let why;
    try {
      while (true) {
        why = this._step(out);
        if (why === 'end') { this.eof = true; break; }
        if (why === 'out') { if (out.full() || !out.grow()) break; continue; }
        break;   // 'input'
      }
    } catch (e) {
      this._broken = e instanceof LzmaDataError ? new LzmaError(DATA_ERROR) : e;
      throw this._broken;
    }
    if (this.eof) {
      this.needsInput = false;
      if (inp.pos < inp.end) this.unusedData = inp.buf.slice(inp.pos, inp.end);
    } else if (why === 'input' || inp.pos === inp.end) {
      // (input held inside a symbol not yet whole is consumed, as liblzma's range decoder has it)
      this.needsInput = !out.full();
    } else {
      this.needsInput = false;
    }
    return out.result();
  }
  // pull from a chain into out: 'end' | 'input' | 'out'
  _pull(chain, out) {
    if (out.room() === 0) return 'out';
    const r = chain.code(out.buf, out.pos, Math.min(out.buf.length, out.max), RUN$filters);
    const made = r.pos - out.pos;
    out.pos = r.pos;
    this._lastMade = made;
    if (r.end) return 'end';
    if (out.room() === 0) return 'out';
    return 'input';
  }
}

// ── raw ──
class RawDecoder extends Decompressor$decoder {
  constructor(filters, memlimit = Infinity) {
    super();
    if (!filters.length || filters.length > 4) throw new LzmaError(OPTIONS_ERROR);
    const last = filters[filters.length - 1];
    const o = lzmaOptions(last);
    if (memusage(o.dictSize) > memlimit) throw new LzmaError(MEMLIMIT_ERROR);
    const lz = last.id === FILTER_LZMA2 ? new Lzma2Source(this.inp, o.dictSize) : new Lzma1Source(this.inp, o, Infinity, true);
    if (last.id === FILTER_LZMA2) lz.core.resetState(o.lc, o.lp, o.pb);
    this.chain = decoderChain(filters, this.inp, lz);
    this.check = 0;   // (CHECK_NONE)
  }
  _step(out) {
    const r = this._pull(this.chain, out);
    return r;
  }
}

// ── .lzma: 13-byte header, then LZMA1 ──
class AloneDecoder extends Decompressor$decoder {
  // picky (as the auto decoder is): the dictionary size 2^n or 2^n + 2^(n-1), a known size < 2^38
  constructor(memlimit = Infinity, picky = false) { super(); this.memlimit = memlimit; this.picky = picky; this.src = null; this.check = 0; }
  _step(out) {
    const inp = this.inp;
    if (!this.src) {
      // (checked as its bytes come, as liblzma reads it: a bad first byte fails at once)
      const have = inp.end - inp.pos;
      if (have >= 1 && !lclppbDecode(inp.buf[inp.pos])) throw new LzmaError(FORMAT_ERROR);
      if (have >= 5 && this.picky) {
        const ds = (inp.buf[inp.pos + 1] | (inp.buf[inp.pos + 2] << 8) | (inp.buf[inp.pos + 3] << 16) | (inp.buf[inp.pos + 4] << 24)) >>> 0;
        let d = ds - 1;
        d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
        if (ds !== 0xffffffff && ((d >>> 0) + 1) !== ds) throw new LzmaError(FORMAT_ERROR);
      }
      if (have < 13) return 'input';
      const h = inp.buf.subarray(inp.pos, inp.pos + 13);
      const p = lclppbDecode(h[0]);
      const dictSize = (h[1] | (h[2] << 8) | (h[3] << 16) | (h[4] << 24)) >>> 0;
      let size = 0n;
      for (let i = 12; i >= 5; i--) size = (size << 8n) | BigInt(h[i]);
      const unknown = size === 0xffffffffffffffffn;
      if (this.picky) {
        if (dictSize !== 0xffffffff) {
          let d = dictSize - 1;
          d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
          if (((d >>> 0) + 1) !== dictSize) throw new LzmaError(FORMAT_ERROR);
        }
        if (!unknown && size >= (1n << 38n)) throw new LzmaError(FORMAT_ERROR);
      }
      if (memusage(dictSize) > this.memlimit) throw new LzmaError(MEMLIMIT_ERROR);
      inp.pos += 13;
      this.src = new Lzma1Source(inp, { dictSize, lc: p[0], lp: p[1], pb: p[2] }, unknown ? Infinity : Number(size), true);
    }
    return this._pull(this.src, out);
  }
}

// ── .xz ──
const S_HEADER = 0, S_BLOCK_START = 1, S_BLOCK_HEADER = 2, S_BLOCK = 3, S_PADDING = 4, S_CHECK = 5, S_INDEX = 6, S_FOOTER = 7;
const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];

function vliDecode(buf, pos, end) {
  let v = 0n, shift = 0n;
  for (let i = 0; i < 9; i++) {
    if (pos + i >= end) return null;
    const b = buf[pos + i];
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) {
      if (b === 0 && i > 0) throw new LzmaDataError();
      return [v, i + 1];
    }
    shift += 7n;
  }
  throw new LzmaDataError();
}

class XzDecoder extends Decompressor$decoder {
  constructor(memlimit = Infinity) {
    super();
    this.memlimit = memlimit;
    this.seq = S_HEADER;
    this.records = [];
  }
  _need(n) { return this.inp.end - this.inp.pos >= n; }
  _step(out) {
    const inp = this.inp;
    while (true) {
      switch (this.seq) {
        case S_HEADER: {
          if (!this._need(12)) return 'input';
          const h = inp.buf.subarray(inp.pos, inp.pos + 12);
          for (let i = 0; i < 6; i++) if (h[i] !== MAGIC[i]) throw new LzmaError(FORMAT_ERROR);
          const crc = (h[8] | (h[9] << 8) | (h[10] << 16) | (h[11] << 24)) >>> 0;
          if (crc32(h, 0, 6, 8) !== crc) throw new LzmaDataError();
          if (h[6] !== 0 || (h[7] & 0xf0)) throw new LzmaError(OPTIONS_ERROR);
          this.flags = [h[6], h[7]];
          this.check = h[7];
          inp.pos += 12;
          this.seq = S_BLOCK_START;
          break;
        }
        case S_BLOCK_START: {
          if (!this._need(1)) return 'input';
          if (inp.buf[inp.pos] === 0x00) { this.seq = S_INDEX; break; }
          this.headerSize = (inp.buf[inp.pos] + 1) * 4;
          this.seq = S_BLOCK_HEADER;
          break;
        }
        case S_BLOCK_HEADER: {
          if (!this._need(this.headerSize)) return 'input';
          this._blockHeader(inp.buf.subarray(inp.pos, inp.pos + this.headerSize));
          inp.pos += this.headerSize;
          this.seq = S_BLOCK;
          break;
        }
        case S_BLOCK: {
          // (the input buffer is rebuilt per call: measure what this pull took)
          const before = out.pos, inStart = inp.pos;
          const r = this._pull(this.chain, out);
          if (out.pos > before) this.blockCheck.update(out.buf, before, out.pos);
          this.blockUncompressed += out.pos - before;
          this.blockCompressed += inp.pos - inStart;
          if (this.declUncompressed !== null && this.blockUncompressed > this.declUncompressed) throw new LzmaDataError();
          if (this.declCompressed !== null && this.blockCompressed > this.declCompressed) throw new LzmaDataError();
          if (r !== 'end') return r;
          if (this.declUncompressed !== null && this.blockUncompressed !== this.declUncompressed) throw new LzmaDataError();
          if (this.declCompressed !== null && this.blockCompressed !== this.declCompressed) throw new LzmaDataError();
          this.seq = S_PADDING;
          break;
        }
        case S_PADDING: {
          // (the index records the block's size before its padding)
          while ((this.blockCompressed + this.padded) & 3) {
            if (!this._need(1)) return 'input';
            if (inp.buf[inp.pos++] !== 0) throw new LzmaDataError();
            ++this.padded;
          }
          this.seq = S_CHECK;
          this.unpaddedNoCheck = this.headerSize + this.blockCompressed;
          break;
        }
        case S_CHECK: {
          const n = checkSize(this.check);
          if (!this._need(n)) return 'input';
          if (isCheckSupported(this.check) && this.check !== 0) {
            const want = this.blockCheck.finish();
            for (let i = 0; i < n; i++) if (inp.buf[inp.pos + i] !== want[i]) throw new LzmaDataError();
          }
          inp.pos += n;
          this.records.push([BigInt(this.unpaddedNoCheck + n), BigInt(this.blockUncompressed)]);
          this.seq = S_BLOCK_START;
          break;
        }
        case S_INDEX: {
          // (read whole: indicator, count, records, padding, CRC32)
          const r = this._index();
          if (r === null) return 'input';
          this.indexSize = r;
          this.seq = S_FOOTER;
          break;
        }
        case S_FOOTER: {
          if (!this._need(12)) return 'input';
          const f = inp.buf.subarray(inp.pos, inp.pos + 12);
          if (f[10] !== 0x59 || f[11] !== 0x5a) throw new LzmaDataError();
          const crc = (f[0] | (f[1] << 8) | (f[2] << 16) | (f[3] << 24)) >>> 0;
          if (crc32(f, 0, 4, 10) !== crc) throw new LzmaDataError();
          const backward = ((f[4] | (f[5] << 8) | (f[6] << 16) | (f[7] << 24)) >>> 0) + 1;
          if (backward * 4 !== this.indexSize) throw new LzmaDataError();
          if (f[8] !== this.flags[0] || f[9] !== this.flags[1]) throw new LzmaDataError();
          inp.pos += 12;
          return 'end';
        }
      }
    }
  }
  _blockHeader(h) {
    const size = h.length;
    const crc = (h[size - 4] | (h[size - 3] << 8) | (h[size - 2] << 16) | (h[size - 1] << 24)) >>> 0;
    if (crc32(h, 0, 0, size - 4) !== crc) throw new LzmaDataError();
    const flags = h[1];
    if (flags & 0x3c) throw new LzmaError(OPTIONS_ERROR);
    let pos = 2;
    const end = size - 4;
    this.declCompressed = null; this.declUncompressed = null;
    if (flags & 0x40) { const v = vliDecode(h, pos, end); if (!v || v[0] === 0n) throw new LzmaDataError(); this.declCompressed = Number(v[0]); pos += v[1]; }
    if (flags & 0x80) { const v = vliDecode(h, pos, end); if (!v) throw new LzmaDataError(); this.declUncompressed = Number(v[0]); pos += v[1]; }
    const count = (flags & 3) + 1;
    const filters = [];
    for (let i = 0; i < count; i++) {
      const idv = vliDecode(h, pos, end); if (!idv) throw new LzmaDataError(); pos += idv[1];
      const psv = vliDecode(h, pos, end); if (!psv) throw new LzmaDataError(); pos += psv[1];
      const ps = Number(psv[0]);
      if (pos + ps > end) throw new LzmaDataError();
      filters.push(decodeFilterProps(idv[0], h.subarray(pos, pos + ps)));
      pos += ps;
    }
    for (; pos < end; pos++) if (h[pos] !== 0) throw new LzmaError(OPTIONS_ERROR);
    const last = filters[filters.length - 1];
    if (last.id !== FILTER_LZMA2) throw new LzmaError(OPTIONS_ERROR);
    for (let i = 0; i < filters.length - 1; i++) if (!(filters[i].id === FILTER_DELTA || isBcj(filters[i].id))) throw new LzmaError(OPTIONS_ERROR);
    if (memusage(last.dictSize) > this.memlimit) throw new LzmaError(MEMLIMIT_ERROR);
    this.chain = decoderChain(filters, this.inp, new Lzma2Source(this.inp, last.dictSize));
    this.blockCheck = new Check(isCheckSupported(this.check) ? this.check : 0);
    this.blockCompressed = 0;
    this.blockUncompressed = 0;
    this.padded = 0;
  }

  _index() {
    const inp = this.inp;
    const buf = inp.buf;
    let pos = inp.pos;
    const end = inp.end;
    if (pos >= end) return null;
    if (buf[pos] !== 0x00) throw new LzmaDataError();
    pos++;
    const cv = vliDecode(buf, pos, end); if (!cv) return null; pos += cv[1];
    if (Number(cv[0]) !== this.records.length) throw new LzmaDataError();
    for (const [unpadded, uncompressed] of this.records) {
      const a = vliDecode(buf, pos, end); if (!a) return null; pos += a[1];
      const b = vliDecode(buf, pos, end); if (!b) return null; pos += b[1];
      if (a[0] !== unpadded || b[0] !== uncompressed) throw new LzmaDataError();
    }
    while ((pos - inp.pos) & 3) { if (pos >= end) return null; if (buf[pos++] !== 0) throw new LzmaDataError(); }
    if (pos + 4 > end) return null;
    const crc = (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
    if (crc32(buf, 0, inp.pos, pos) !== crc) throw new LzmaDataError();
    pos += 4;
    const size = pos - inp.pos;
    inp.pos = pos;
    return size;
  }
}

// a filter's options from its ID and property bytes (lzma_properties_decode)
function decodeFilterProps(id, props) {
  const n = typeof id === 'bigint' ? id : BigInt(id);
  if (n === BigInt(FILTER_LZMA2)) {
    if (props.length !== 1) throw new LzmaError(OPTIONS_ERROR);
    const dictSize = lzma2DictSize(props[0]);
    if (dictSize === null) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_LZMA2, dictSize };
  }
  if (n === FILTER_LZMA1) {
    if (props.length !== 5) throw new LzmaError(OPTIONS_ERROR);
    const p = lclppbDecode(props[0]);
    if (!p) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_LZMA1, lc: p[0], lp: p[1], pb: p[2], dictSize: (props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0 };
  }
  if (n === BigInt(FILTER_DELTA)) {
    if (props.length !== 1) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_DELTA, dist: props[0] + 1 };
  }
  const small = Number(n);
  if (n < 0x100n && isBcj(small)) {
    if (props.length === 0) return { id: small };
    if (props.length !== 4) throw new LzmaError(OPTIONS_ERROR);
    return { id: small, start_offset: (props[0] | (props[1] << 8) | (props[2] << 16) | (props[3] << 24)) >>> 0 };
  }
  throw new LzmaError(OPTIONS_ERROR);
}

// ── auto: .xz by its first byte, .lzma otherwise (auto_decoder.c) ──
class AutoDecoder extends Decompressor$decoder {
  constructor(memlimit = Infinity) { super(); this.memlimit = memlimit; this.inner = null; }
  _step(out) {
    if (!this.inner) {
      if (this.inp.pos === this.inp.end) return 'input';
      this.inner = this.inp.buf[this.inp.pos] === 0xfd ? new XzDecoder(this.memlimit) : new AloneDecoder(this.memlimit, true);
      this.inner.inp = this.inp;
      this.inner._pull = this._pull.bind(this.inner);
    }
    const r = this.inner._step(out);
    this.check = this.inner.check;
    return r;
  }
}

// ── src/main.js ──

// @gcu/lzma — xz / LZMA in plain JavaScript, both ways: liblzma 5.8.1 ported, so what it writes
// is byte for byte what liblzma (the xz tool, CPython's lzma) writes, and it reads what they read
// — .xz with its checks, .lzma, raw LZMA1 / LZMA2, and the delta and branch filters — streamed,
// as CPython's LZMACompressor / LZMADecompressor, member for member.
//
//   compress(bytes, { format, check, preset, filters })   → bytes
//   decompress(bytes, { format, memlimit, filters })      → bytes (concatenated streams too)
//   new Compressor({ format, check, preset, filters })    .compress(bytes), .flush()
//   new Decompressor({ format, memlimit, filters })       .decompress(bytes, maxLength = -1);
//                                                        .eof .needsInput .unusedData .check
//
// format: 'xz' (default) | 'alone' | 'raw' (filters required) | 'auto' (decoding: .xz or .lzma).
// A filter is { id, ...options }: FILTER_LZMA2 / FILTER_LZMA1 { preset, dictSize, lc, lp, pb,
// mode ('fast' | 'normal'), niceLen, mf, depth }, FILTER_DELTA { dist }, the BCJ filters
// { start_offset }.


// an LZMA1 / LZMA2 filter's options in full: its preset (default 6), then the fields it gives
const resolveLzmaOptions = (f) => ({ ...lzmaOptions(f), id: f.id });

class Compressor {
  constructor({ format = 'xz', check = -1, preset = null, filters = null } = {}) {
    if (format === 'xz') {
      const c = check === -1 ? CHECK_CRC64 : check;
      this._e = new XzEncoder(filters || [{ id: FILTER_LZMA2, preset: preset ?? PRESET_DEFAULT }], c);
    } else if (format === 'alone') {
      if (check !== -1 && check !== CHECK_NONE) throw new LzmaError('Invalid or unsupported options');
      if (filters && (filters.length !== 1 || filters[0].id !== FILTER_LZMA1)) throw new LzmaError('Invalid filter chain for FORMAT_ALONE - must be a single LZMA1 filter');
      this._e = new AloneEncoder(filters ? filters[0] : { preset: preset ?? PRESET_DEFAULT });
    } else if (format === 'raw') {
      if (!filters) throw new LzmaError('Must specify filters for FORMAT_RAW');
      if (check !== -1 && check !== CHECK_NONE) throw new LzmaError('Invalid or unsupported options');
      this._e = new RawStreamEncoder(filters);
    } else {
      throw new LzmaError('Invalid container format');
    }
  }
  compress(data) { return this._e.compress(data); }
  flush() { return this._e.flush(); }
}

function Decompressor$main({ format = 'auto', memlimit = null, filters = null } = {}) {
  const ml = memlimit === null || memlimit === undefined ? Infinity : memlimit;
  if (format === 'raw') {
    if (!filters) throw new LzmaError('Must specify filters for FORMAT_RAW');
    return new RawDecoder(filters, ml);
  }
  if (filters) throw new LzmaError('Cannot specify filters except with FORMAT_RAW');
  if (format === 'xz') return new XzDecoder(ml);
  if (format === 'alone') return new AloneDecoder(ml);
  if (format === 'auto') return new AutoDecoder(ml);
  throw new LzmaError('Invalid container format');
}

function compress(data, opts = {}) {
  const c = new Compressor(opts);
  return concat([c.compress(data), c.flush()]);
}

// as CPython's lzma.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
function decompress(data, opts = {}) {
  const parts = [];
  while (true) {
    const d = Decompressor$main(opts);
    let res;
    try { res = d.decompress(data); } catch (e) {
      if (parts.length && e instanceof LzmaError) break;
      throw e;
    }
    parts.push(res);
    if (!d.eof) throw new LzmaError('Compressed data ended before the end-of-stream marker was reached');
    data = d.unusedData;
    if (!data.length) break;
  }
  return concat(parts);
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
return { LzmaError, PRESET_DEFAULT, PRESET_EXTREME, CHECK_NONE, CHECK_CRC32, CHECK_CRC64, CHECK_SHA256, CHECK_ID_MAX, CHECK_UNKNOWN, isCheckSupported, FILTER_LZMA1, FILTER_LZMA2, FILTER_DELTA, FILTER_X86, FILTER_POWERPC, FILTER_IA64, FILTER_ARM, FILTER_ARMTHUMB, FILTER_SPARC, FILTER_ARM64, FILTER_RISCV, MF_HC3, MF_HC4, MF_BT2, MF_BT3, MF_BT4, filterProps, decodeFilterProps, validateChain, presetOptions, resolveLzmaOptions, Compressor, Decompressor: Decompressor$main, compress, decompress };
})();

// -- vendor alias bindings (collision-safe namespacing) --

const unzipSync = fflate.unzipSync;
const zipSync = fflate.zipSync;
const gzipSync_fflate = fflate.gzipSync;
const gunzipSync_fflate = fflate.gunzipSync;
const Unzip = fflate.Unzip;
const UnzipInflate = fflate.UnzipInflate;
const UnzipPassThrough = fflate.UnzipPassThrough;
const Zip = fflate.Zip;
const ZipDeflate = fflate.ZipDeflate;
const ZipPassThrough = fflate.ZipPassThrough;
const fzstd_decompress = fzstd.decompress;
const fzstd_Decompress = fzstd.Decompress;
const fzstd_ZstdErrorCode = fzstd.ZstdErrorCode;


// -- detect.js --

// Format detection by magic bytes, with an extension-based fallback for
// callers who only have a filename (no buffer access). The byte path is
// authoritative — extension is best-effort.
//
// Magic-byte references (per the archive spec §3.3):
//   ZIP     PK (0x50 0x4B) at offset 0
//   tar     "ustar" (0x75 0x73 0x74 0x61 0x72) at offset 257
//   gzip    1f 8b at offset 0
//   zstd    28 b5 2f fd at offset 0
//   xz      fd 37 7a 58 5a 00 at offset 0
//   bz2     BZh (0x42 0x5a 0x68) at offset 0

const FORMATS = ['zip', 'tar', 'tar.gz', 'tar.zst', 'tar.xz', 'tar.bz2',
                 'gz', 'zst', 'xz', 'bz2'];

// Probe `bytes` (Uint8Array | ArrayBuffer | Buffer-like) and return one of
// 'zip' | 'tar' | 'gz' | 'zst' | 'xz' | 'bz2' | null. Tar wins over gz/zst/xz/bz2
// only when its ustar header is intact at offset 257; otherwise we report the
// outer container (`gz` for a gzipped tar — the caller decompresses then re-detects).
function detectFormat(bytes) {
  if (!bytes) return null;
  const u = bytes instanceof Uint8Array ? bytes :
            (bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength) :
             new Uint8Array(bytes));
  if (u.length < 2) return null;

  // ZIP — 'PK' at offset 0. (Empty ZIPs start with PK\x05\x06, regular ones with PK\x03\x04.)
  if (u[0] === 0x50 && u[1] === 0x4B) return 'zip';

  // gzip — 1f 8b. Could be a gzip-of-tar, but the caller decompresses first.
  if (u[0] === 0x1f && u[1] === 0x8b) return 'gz';

  // zstd — 28 b5 2f fd (little-endian magic, RFC 8478 §3.1.1.1.1).
  if (u.length >= 4 && u[0] === 0x28 && u[1] === 0xb5 && u[2] === 0x2f && u[3] === 0xfd) return 'zst';

  // xz — fd 37 7a 58 5a 00.
  if (u.length >= 6 && u[0] === 0xfd && u[1] === 0x37 && u[2] === 0x7a
      && u[3] === 0x58 && u[4] === 0x5a && u[5] === 0x00) return 'xz';

  // bz2 — 'BZh'.
  if (u.length >= 3 && u[0] === 0x42 && u[1] === 0x5a && u[2] === 0x68) return 'bz2';

  // tar — 'ustar' at offset 257 (POSIX ustar header). Tar's magic is far
  // into the file because tar is offset-based; we check it last.
  if (u.length >= 263
      && u[257] === 0x75 && u[258] === 0x73 && u[259] === 0x74
      && u[260] === 0x61 && u[261] === 0x72) return 'tar';

  return null;
}

// Map a filename extension to a format. Best-effort; the magic-byte sniff is
// authoritative when bytes are available. The compound forms ('.tar.gz') are
// recognized too so callers can route to a tar-on-top-of-gz pipeline directly.
function magicForFormat(filename) {
  if (typeof filename !== 'string') return null;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz')  || lower.endsWith('.tgz'))  return 'tar.gz';
  if (lower.endsWith('.tar.zst') || lower.endsWith('.tzst')) return 'tar.zst';
  if (lower.endsWith('.tar.xz')  || lower.endsWith('.txz'))  return 'tar.xz';
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tar.bz2';
  if (lower.endsWith('.zip'))                                return 'zip';
  if (lower.endsWith('.tar'))                                return 'tar';
  if (lower.endsWith('.gz'))                                 return 'gz';
  if (lower.endsWith('.zst'))                                return 'zst';
  if (lower.endsWith('.xz'))                                 return 'xz';
  if (lower.endsWith('.bz2'))                                return 'bz2';
  return null;
}

// -- source.js --

// Source adapter — normalize whatever the caller hands us into a thin
// `{ bytes(): Promise<Uint8Array>, name: string|null }` shape that the
// per-format handlers can consume without caring where the bytes came from.
//
// Accepted source shapes:
//   - Uint8Array | ArrayBuffer                    in-memory bytes (sync)
//   - Blob                                        browser Blob (async .arrayBuffer)
//   - { vfs, path }                               VFS adapter (uses vfs.readFile)
//   - { fetch: '<url>' [, fetchFn] }              lazy fetch from URL
//   - ReadableStream<Uint8Array>                  drained on first .bytes() call
//
// `name` is preserved when known — used as an extension hint when magic-byte
// detection is ambiguous.

// Renamed from `basename` to avoid colliding with @gcu/vfs's exported
// `basename` function in worker bundles that compose both libs into one
// scope (e.g. the geas worker, which inlines @gcu/archive via build-time
// concat).
const _arcBasename = (p) => String(p).split(/[\\/]/).pop();

function normalizeSource(input) {
  if (!input) throw new TypeError('source: required');

  // Uint8Array / ArrayBuffer / Buffer-like — wrap as-is.
  if (input instanceof Uint8Array) {
    const b = input;
    return { bytes: async () => b, name: null };
  }
  if (input instanceof ArrayBuffer) {
    const b = new Uint8Array(input);
    return { bytes: async () => b, name: null };
  }

  // Blob — has .arrayBuffer().
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return {
      bytes: async () => new Uint8Array(await input.arrayBuffer()),
      name: input.name || null,
    };
  }

  // ReadableStream — drain into a single Uint8Array on first call. (For
  // larger archives the format handlers can opt into the streaming `Unzip`
  // path via archive.stream(); this adapter is the "small archive, eager"
  // path.)
  if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
    return {
      bytes: async () => new Uint8Array(await new Response(input).arrayBuffer()),
      name: null,
    };
  }

  // Object descriptors.
  if (typeof input === 'object') {
    // { vfs, path }
    if (input.vfs && typeof input.path === 'string') {
      return {
        bytes: async () => {
          // Request 'bytes' encoding explicitly — without it, the
          // MemoryBackend returns TextDecoder().decode(bytes), which
          // substitutes U+FFFD for any byte outside a valid UTF-8 sequence
          // and corrupts binary. CommentBackend / IDBBackend behave
          // similarly. Backends that don't recognize 'bytes' fall through
          // to the same code path; the resulting string is encoded back to
          // utf8, which round-trips for text but not for binary — same
          // behaviour as before for those backends.
          const r = input.vfs.readFile(input.path, 'bytes');
          const v = (r && typeof r.then === 'function') ? await r : r;
          if (v instanceof Uint8Array) return v;
          if (typeof v === 'string') return new TextEncoder().encode(v);
          if (v && v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
          throw new TypeError('vfs.readFile returned unsupported shape');
        },
        name: _arcBasename(input.path),
      };
    }
    // { fetch: url, fetchFn? }
    if (typeof input.fetch === 'string') {
      const fetchFn = input.fetchFn || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
      if (!fetchFn) throw new TypeError('source: { fetch } requires a fetch implementation in the environment');
      return {
        bytes: async () => {
          const r = await fetchFn(input.fetch);
          if (!r || !r.ok) throw new Error(`fetch ${input.fetch}: HTTP ${r ? r.status : 'no-response'}`);
          return new Uint8Array(await r.arrayBuffer());
        },
        name: _arcBasename(input.fetch.split('?')[0]),
      };
    }
  }

  throw new TypeError('source: unrecognized shape — expected Uint8Array | ArrayBuffer | Blob | ReadableStream | { vfs, path } | { fetch }');
}

// -- sink.js --

// Sink adapter — normalize a destination into a thin shape the format
// handlers write extraction output through. Mirrors source.js.
//
// Accepted sink shapes:
//   - { vfs, path }       VFS adapter; `path` is the destination directory.
//                         writeFile creates path/<entry>; mkdir creates
//                         path/<entryDir>. Both auto-create parents.
//   - 'memory'            Returns the populated `Map<innerPath, Uint8Array>`
//                         from the sink's `.result()` method.
//   - WritableStream      Streaming write (not yet implemented for extract;
//                         placeholder shape for future compress streaming).
//
// Overwrite semantics ('error' | 'skip' | 'rename' | 'overwrite') are handled
// by the per-format extract code, not here — the sink just writes when asked.

const joinPath = (a, b) => {
  if (!a || a === '/') return '/' + String(b).replace(/^\/+/, '');
  return a.replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '');
};

const parentOf = (p) => {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
};

// Finder-style auto-rename: file.csv → file (2).csv → file (3).csv ...
// Shared by the per-format extract paths (zip / tar / single-file) so the
// behaviour is identical regardless of source format. Bounded at 1000 to
// surface bugs rather than spin forever; real archives never hit this.
async function autoRename(sink, name) {
  const dot = name.lastIndexOf('.');
  const slash = name.lastIndexOf('/');
  // Don't split on a dot that's inside a parent dir name.
  const stem = (dot > slash) ? name.slice(0, dot) : name;
  const ext  = (dot > slash) ? name.slice(dot)    : '';
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await sink.exists(candidate))) return candidate;
  }
  throw new Error('extract: too many rename collisions');
}

function normalizeSink(input) {
  if (!input) throw new TypeError('sink: required');

  // 'memory' — collect into a Map. result() drains it.
  if (input === 'memory') {
    const map = new Map();
    return {
      kind: 'memory',
      async writeFile(innerPath, bytes) {
        map.set(innerPath, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      },
      async mkdir(/* innerPath */) { /* memory sink doesn't track dirs */ },
      async exists(innerPath)      { return map.has(innerPath); },
      result()                     { return map; },
    };
  }

  // { vfs, path } — VFS adapter with destination directory.
  if (typeof input === 'object' && input.vfs && typeof input.path === 'string') {
    const vfs = input.vfs;
    const root = input.path.replace(/\/+$/, '') || '/';
    const callMaybeAsync = async (fn) => {
      const r = fn();
      return (r && typeof r.then === 'function') ? await r : r;
    };
    return {
      kind: 'vfs',
      root,
      async writeFile(innerPath, bytes) {
        const full = joinPath(root, innerPath);
        const dir = parentOf(full);
        try { await callMaybeAsync(() => vfs.mkdir(dir, { recursive: true })); } catch {}
        await callMaybeAsync(() => vfs.writeFile(full,
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
      },
      async mkdir(innerPath) {
        const full = joinPath(root, innerPath);
        try { await callMaybeAsync(() => vfs.mkdir(full, { recursive: true })); } catch {}
      },
      async exists(innerPath) {
        const full = joinPath(root, innerPath);
        try {
          const r = await callMaybeAsync(() => vfs.exists ? vfs.exists(full) :
            (vfs.stat ? vfs.stat(full).then(() => true, () => false) : false));
          return !!r;
        } catch { return false; }
      },
    };
  }

  // WritableStream — not yet hooked up for extract.
  if (typeof WritableStream !== 'undefined' && input instanceof WritableStream) {
    throw new TypeError('sink: WritableStream is reserved for streaming compress (not yet implemented)');
  }

  throw new TypeError('sink: unrecognized shape — expected { vfs, path } | "memory" | WritableStream');
}

// -- zip.js --

// ZIP read via fflate (vendored). Sync surface for v0.1; the streaming
// `Unzip` class is available for archive.stream() when it lands.
//
// Note: at runtime (after the build concatenates everything into one
// scope), fflate's `unzipSync` lives at the top of the same scope —
// these imports get stripped, references resolve directly.
//
// Entry shape we expose (matches the spec §3.2 list() shape):
//   { path, type: 'file' | 'directory', size, compressed?, mtime? }
//
// Directories in fflate's output appear as zero-byte entries whose path
// ends with '/'; we translate those into type: 'directory'.



// listZip(bytes) → entries[]
// fflate's unzipSync decompresses everything into a `{ name: Uint8Array }`
// map. For v0.1 we accept the cost — list-only routes also discard the data
// after measuring. The streaming Unzip path will land in archive.stream()
// for huge archives.
function listZip(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('listZip: bytes must be a Uint8Array');
  }
  const map = unzipSync(bytes);
  const out = [];
  for (const [name, data] of Object.entries(map)) {
    const isDir = name.endsWith('/');
    out.push(isDir
      ? { path: name, type: 'directory' }
      : { path: name, type: 'file', size: data.length });
  }
  return out;
}

// readZip(bytes, innerPath) → Uint8Array | null
// Extract a single entry. Returns null if the entry isn't present.
// Same caveat as listZip — fflate's sync API decompresses everything; for
// archives with many entries the streaming path is better.
function readZip(bytes, innerPath) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('readZip: bytes must be a Uint8Array');
  }
  if (typeof innerPath !== 'string' || !innerPath) {
    throw new TypeError('readZip: innerPath must be a non-empty string');
  }
  const map = unzipSync(bytes, { filter: (file) => file.name === innerPath });
  const data = map[innerPath];
  return data || null;
}

// extractZip(bytes, sink, opts?) → { count, paths }
// Walk every entry, write through the sink. opts.overwrite controls
// collision behavior: 'error' (default) throws, 'skip' skips, 'rename'
// auto-suffixes (Finder-shape, file (2).csv), 'overwrite' clobbers.
async function extractZip(bytes, sink, opts) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('extractZip: bytes must be a Uint8Array');
  }
  const map = unzipSync(bytes);
  const overwrite = (opts && opts.overwrite) || 'error';
  const filter = (opts && opts.filter) || null;
  const progress = (opts && opts.progress) || null;
  const paths = [];

  // Total byte count (best-effort for progress reporting).
  let total = 0;
  for (const v of Object.values(map)) if (v && v.length) total += v.length;
  let done = 0;

  for (const [name, data] of Object.entries(map)) {
    if (filter && !filter({ path: name })) continue;
    const isDir = name.endsWith('/');
    if (isDir) {
      await sink.mkdir(name);
      paths.push(name);
      continue;
    }

    let targetName = name;
    if (await sink.exists(targetName)) {
      if (overwrite === 'error')     throw new Error(`extract: destination exists — ${name}`);
      else if (overwrite === 'skip') continue;
      else if (overwrite === 'rename') targetName = await autoRename(sink, name);
      // 'overwrite' falls through and clobbers.
    }
    await sink.writeFile(targetName, data);
    paths.push(targetName);
    done += data.length;
    if (progress) progress({ path: name, bytesDone: done, bytesTotal: total });
  }
  return { count: paths.length, paths };
}

// -- tar.js --

// POSIX ustar reader + writer. ~150 LOC inline implementation — the format
// is simple enough that vendoring a library would add more bytes than the
// implementation itself.
//
// Format recap:
//   - Archive = sequence of (header + data) records, each padded to 512.
//   - Header is 512 bytes; only the first ~500 are used. Trailing pad is NUL.
//   - Numeric fields are ASCII octal, NUL- or space-terminated.
//   - End of archive: two consecutive 512-byte blocks of all zeros.
//   - Typeflag '0' or '\0' = regular file; '5' = directory; others ignored.
//   - Paths up to 100 chars in `name`; longer ones use `prefix` (155 chars)
//     and join as `${prefix}/${name}`. Anything beyond ~255 chars needs
//     PAX/GNU long-link extensions (not implemented yet).
//
// All sizes / offsets are spec-mandated; magic numbers below are field
// boundaries within the 512-byte header, not arbitrary choices.

const BLOCK = 512;

// ── Helpers ─────────────────────────────────────────────────────────────

function _readString(block, off, len) {
  let end = off;
  while (end < off + len && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(off, end));
}

function _readOctal(block, off, len) {
  // The trailing byte is typically NUL or space; trim and parse.
  const s = _readString(block, off, len).trim();
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

function _isAllZero(block) {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

function _writeString(block, off, maxLen, s) {
  const bytes = new TextEncoder().encode(String(s));
  const len = Math.min(bytes.length, maxLen);
  block.set(bytes.subarray(0, len), off);
  // Trailing space stays zero — that's the NUL terminator.
}

function _writeOctal(block, off, len, n) {
  // Right-aligned octal ASCII + trailing NUL (POSIX style).
  const s = Math.floor(n).toString(8);
  const fieldLen = len - 1;        // leave room for the NUL
  if (s.length > fieldLen) throw new Error(`tar: value ${n} too large for ${len}-byte field`);
  const padded = s.padStart(fieldLen, '0');
  for (let i = 0; i < fieldLen; i++) block[off + i] = padded.charCodeAt(i);
  block[off + fieldLen] = 0;
}

// Per POSIX, the checksum is the sum of all bytes in the header treating the
// chksum field itself as 8 spaces (0x20). Written back as octal (6 digits +
// NUL + space) so writers can be lenient.
function _computeChecksum(block) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += (i >= 148 && i < 156) ? 0x20 : block[i];
  }
  return sum;
}

// ── parseHeader ─────────────────────────────────────────────────────────

function _parseHeader(block) {
  if (_isAllZero(block)) return null;
  const name     = _readString(block, 0,   100);
  const mode     = _readOctal (block, 100, 8);
  const uid      = _readOctal (block, 108, 8);
  const gid      = _readOctal (block, 116, 8);
  const size     = _readOctal (block, 124, 12);
  const mtime    = _readOctal (block, 136, 12);
  const chksum   = _readOctal (block, 148, 8);
  const typeflag = String.fromCharCode(block[156]);
  const linkname = _readString(block, 157, 100);
  const magic    = _readString(block, 257, 6);
  const prefix   = _readString(block, 345, 155);
  const fullPath = prefix ? `${prefix}/${name}` : name;
  return { path: fullPath, mode, uid, gid, size, mtime, chksum, typeflag, linkname, magic };
}

// Treat the entry as a file when typeflag is '0' or NUL (the legacy zero
// byte from pre-POSIX tars). Treat as a directory when '5' or the path ends
// with '/'. Anything else (symlinks, fifos, pax extended headers, GNU long
// names) is silently skipped — recognized in `_isUnsupported` so the test
// suite can probe it.
function _isFile(h)      { return h.typeflag === '0' || h.typeflag === '\0' || h.typeflag === ''; }
function _isDirectory(h) { return h.typeflag === '5' || h.path.endsWith('/'); }

// ── Public read API ─────────────────────────────────────────────────────

function listTar(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('listTar: bytes must be a Uint8Array');
  const out = [];
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const hdr = _parseHeader(bytes.subarray(off, off + BLOCK));
    if (!hdr) break;
    if (_isDirectory(hdr)) {
      out.push({ path: hdr.path.endsWith('/') ? hdr.path : hdr.path + '/', type: 'directory' });
    } else if (_isFile(hdr)) {
      out.push({ path: hdr.path, type: 'file', size: hdr.size, mtime: new Date(hdr.mtime * 1000) });
    }
    // Advance past header + data (data rounded up to BLOCK).
    const dataBlocks = Math.ceil(hdr.size / BLOCK);
    off += BLOCK * (1 + dataBlocks);
  }
  return out;
}

function readTar(bytes, innerPath) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('readTar: bytes must be a Uint8Array');
  if (typeof innerPath !== 'string' || !innerPath) {
    throw new TypeError('readTar: innerPath must be a non-empty string');
  }
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const hdr = _parseHeader(bytes.subarray(off, off + BLOCK));
    if (!hdr) break;
    if (_isFile(hdr) && hdr.path === innerPath) {
      return bytes.subarray(off + BLOCK, off + BLOCK + hdr.size);
    }
    const dataBlocks = Math.ceil(hdr.size / BLOCK);
    off += BLOCK * (1 + dataBlocks);
  }
  return null;
}

async function extractTar(bytes, sink, opts) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('extractTar: bytes must be a Uint8Array');
  const overwrite = (opts && opts.overwrite) || 'error';
  const filter    = (opts && opts.filter)    || null;
  const progress  = (opts && opts.progress)  || null;
  const paths = [];

  // Best-effort progress total — sum data sizes from headers.
  let total = 0;
  {
    let probe = 0;
    while (probe + BLOCK <= bytes.length) {
      const hdr = _parseHeader(bytes.subarray(probe, probe + BLOCK));
      if (!hdr) break;
      if (_isFile(hdr)) total += hdr.size;
      probe += BLOCK * (1 + Math.ceil(hdr.size / BLOCK));
    }
  }

  let done = 0;
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const hdr = _parseHeader(bytes.subarray(off, off + BLOCK));
    if (!hdr) break;
    const dataBlocks = Math.ceil(hdr.size / BLOCK);

    if (filter && !filter({ path: hdr.path })) {
      off += BLOCK * (1 + dataBlocks);
      continue;
    }

    if (_isDirectory(hdr)) {
      const p = hdr.path.endsWith('/') ? hdr.path.slice(0, -1) : hdr.path;
      await sink.mkdir(p);
      paths.push(hdr.path.endsWith('/') ? hdr.path : hdr.path + '/');
    } else if (_isFile(hdr)) {
      let target = hdr.path;
      if (await sink.exists(target)) {
        if (overwrite === 'error')     throw new Error(`extract: destination exists — ${hdr.path}`);
        else if (overwrite === 'skip') { off += BLOCK * (1 + dataBlocks); continue; }
        else if (overwrite === 'rename') target = await autoRename(sink, hdr.path);
      }
      const data = bytes.subarray(off + BLOCK, off + BLOCK + hdr.size);
      await sink.writeFile(target, data);
      paths.push(target);
      done += hdr.size;
      if (progress) progress({ path: hdr.path, bytesDone: done, bytesTotal: total });
    }
    // Unsupported typeflags (symlink, pax, etc.) just get skipped — caller
    // sees them missing from the output. A future commit can warn.

    off += BLOCK * (1 + dataBlocks);
  }
  return { count: paths.length, paths };
}

// ── Public write API ────────────────────────────────────────────────────
//
// writeTar({ 'README.md': bytes, 'src/foo.js': bytes, ... }) → Uint8Array
//
// Mirrors fflate's zipSync shape so callers can swap between formats. For
// each entry: build a header block, append data (padded to 512), then the
// final two zero blocks. Directories are inferred from paths ending '/';
// otherwise emitted as type='5' when an entry's value is the empty
// Uint8Array AND the key ends with '/'.

function writeTar(entries, opts) {
  if (!entries || typeof entries !== 'object') {
    throw new TypeError('writeTar: entries must be an object map');
  }
  const mtime = (opts && opts.mtime) || Math.floor(Date.now() / 1000);
  const mode = (opts && opts.mode) || 0o644;
  const chunks = [];

  for (const [path, data] of Object.entries(entries)) {
    const isDir = path.endsWith('/');
    const bytes = isDir ? new Uint8Array(0)
      : (data instanceof Uint8Array ? data : new Uint8Array(data));

    const header = _buildHeader(path, bytes.length, isDir ? '5' : '0',
      isDir ? (mode | 0o111) : mode, mtime);
    chunks.push(header);
    if (bytes.length > 0) {
      chunks.push(bytes);
      const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
      if (pad > 0) chunks.push(new Uint8Array(pad));
    }
  }
  // End-of-archive marker: two zero blocks.
  chunks.push(new Uint8Array(BLOCK * 2));

  // Concat.
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function _buildHeader(path, size, typeflag, mode, mtime) {
  // Split paths > 100 chars into prefix + name.
  let name = path, prefix = '';
  if (path.length > 100) {
    // Find a '/' such that the suffix fits in 100 bytes and the prefix in 155.
    let split = -1;
    for (let i = path.length - 100; i < path.length && i <= 155; i++) {
      if (path[i] === '/') { split = i; break; }
    }
    if (split < 0) throw new Error(`tar: path too long (>255 chars, PAX not yet supported): ${path}`);
    prefix = path.slice(0, split);
    name   = path.slice(split + 1);
  }

  const block = new Uint8Array(BLOCK);
  _writeString(block, 0,   100, name);
  _writeOctal (block, 100, 8,   mode);
  _writeOctal (block, 108, 8,   0);            // uid
  _writeOctal (block, 116, 8,   0);            // gid
  _writeOctal (block, 124, 12,  size);
  _writeOctal (block, 136, 12,  mtime);
  // chksum field stays zero for now — we'll fill below.
  block[156] = typeflag.charCodeAt(0);
  _writeString(block, 257, 6,   'ustar');
  block[263] = 0x30; block[264] = 0x30;        // version '00'
  if (prefix) _writeString(block, 345, 155, prefix);

  // Compute chksum + write back.
  const sum = _computeChecksum(block);
  // GNU convention: 6 octal digits + NUL + space. POSIX accepts either.
  const s = sum.toString(8).padStart(6, '0');
  for (let i = 0; i < 6; i++) block[148 + i] = s.charCodeAt(i);
  block[154] = 0;     // NUL
  block[155] = 0x20;  // space
  return block;
}

// -- gz.js --

// gzip compress + decompress via the native Web Streams (De)CompressionStream
// API. Zero vendored bytes — gzip support is in every browser ≥ 80 and
// Node ≥ 18, which is the floor for this whole project anyway.
//
// Exposes:
//   gunzipBytes(u8) → Promise<Uint8Array>          single-shot decompress
//   gzipBytes(u8) → Promise<Uint8Array>            single-shot compress
//
// api.js wires these into:
//   - archive.list/read/extract dispatch for 'gz' (single-file) and 'tar.gz'
//     (gunzip → re-detect → tar.* dispatch)
//   - archive.gzip / archive.gunzip helpers (single-file source ↔ sink)

// Drain a stream into a Uint8Array. Response().arrayBuffer() is the
// portable path — works in Node 18+ and every modern browser.
async function _drain(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Wrap bytes as a one-chunk ReadableStream so they can be pipeThrough'd.
function _bytesToStream(bytes) {
  return new Blob([bytes]).stream();
}

async function gunzipBytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('gunzipBytes: expected Uint8Array');
  const piped = _bytesToStream(u8).pipeThrough(new DecompressionStream('gzip'));
  return _drain(piped);
}

async function gzipBytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('gzipBytes: expected Uint8Array');
  const piped = _bytesToStream(u8).pipeThrough(new CompressionStream('gzip'));
  return _drain(piped);
}

// Derive an inner filename for single-file gzip archives — strip '.gz' (or
// '.tgz' → '.tar', which is what most tools do when expanding a .tgz).
// Falls back to 'data' when no name is available.
function _gzInnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.tgz'))  return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.tzst')) return sourceName.slice(0, -5) + '.tar';
  if (lower.endsWith('.tbz2')) return sourceName.slice(0, -5) + '.tar';
  if (lower.endsWith('.txz'))  return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.gz'))   return sourceName.slice(0, -3);
  if (lower.endsWith('.zst'))  return sourceName.slice(0, -4);
  if (lower.endsWith('.xz'))   return sourceName.slice(0, -3);
  if (lower.endsWith('.bz2'))  return sourceName.slice(0, -4);
  return sourceName;
}

// -- zst.js --

// Zstandard read via fzstd (vendored). Decode-only; the encoder is a
// separate, larger package that we don't ship in v0.1 — anyone trying to
// .compress to zst gets a clear "decode-only build" error.
//
// At dev time the imports below resolve through ESM directly. At build
// time the imports are stripped and the references hit aliases declared
// after each vendored IIFE (see ext/archive/build.js's "vendor alias
// bindings" section).


// Single-shot decompress. fzstd's API is sync — same shape as fflate's
// unzipSync — so we wrap it in an async function to match gz.js's
// promise-returning shape and keep the API consistent.
async function unzstdBytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('unzstdBytes: expected Uint8Array');
  // fzstd returns a Uint8Array directly; no Promise involved.
  return fzstd_decompress(u8);
}

// Placeholder for the encoder. Throws a clear error pointing at why.
async function zstdBytes(/* u8 */) {
  throw new Error(
    'archive: zstd encode not available in this build — fzstd is decode-only ' +
    'and the encoder package (~120 KB) is not vendored yet. ' +
    'Use tar.gz or zip if you need a writeable archive format right now.'
  );
}

// Derive an inner filename for single-file .zst archives — strip '.zst' (or
// '.tzst' → '.tar'). Mirrors gz.js's _gzInnerName for consistency.
function _zstInnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.tzst')) return sourceName.slice(0, -5) + '.tar';
  if (lower.endsWith('.zst'))  return sourceName.slice(0, -4);
  return sourceName;
}

// -- xz.js --

// xz via @gcu/lzma — liblzma 5.8.1 ported to JavaScript, both ways. What it writes
// is byte-identical to xz's (and CPython's lzma) at the same preset, and it carries
// no Wasm — so a strict-CSP host (no 'wasm-unsafe-eval') reads and writes .xz.
//
// At dev time the import below resolves through ESM directly. At build time the
// import is stripped and `_gcuLzma` is the namespaced, inlined @gcu/lzma bundle (see
// ext/archive/build.js's "inlined @gcu codecs" section).


// Single-shot decompress. Reads .xz (and legacy .lzma) as xz does: concatenated
// streams decode to their concatenation, and every integrity check is verified.
async function unxzBytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('unxzBytes: expected Uint8Array');
  return _gcuLzma.decompress(u8);
}

// Single-shot compress to .xz with a CRC64 check, as `xz` writes. opts.level is the
// preset, 0..9 (xz's default is 6); opts.extreme is `xz -e`.
async function xzBytes(u8, opts = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('xzBytes: expected Uint8Array');
  let preset = typeof opts.level === 'number' ? Math.max(0, Math.min(9, opts.level | 0)) : 6;
  if (opts.extreme) preset |= _gcuLzma.PRESET_EXTREME;
  return _gcuLzma.compress(u8, { format: 'xz', preset });
}

// Derive an inner filename for single-file .xz archives — strip '.xz' (or
// '.txz' → '.tar'). Mirrors gz.js / zst.js for consistency.
function _xzInnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.txz')) return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.xz'))  return sourceName.slice(0, -3);
  return sourceName;
}

// -- bz2.js --

// bzip2 via @gcu/bz2 — libbzip2 1.0.8 ported to JavaScript, both ways. Its output
// is byte-identical to bzip2's (and CPython's bz2), and it carries no Wasm.
//
// At dev time the import below resolves through ESM directly. At build time the
// import is stripped and `_gcuBz2` is the namespaced, inlined @gcu/bz2 bundle (see
// ext/archive/build.js's "inlined @gcu codecs" section).


// Single-shot decompress. Concatenated streams (as `cat a.bz2 b.bz2` makes, and as
// pbzip2 writes) decode to their concatenation, as bunzip2 does.
async function unbz2Bytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('unbz2Bytes: expected Uint8Array');
  return _gcuBz2.decompress(u8);
}

// Single-shot compress. opts.level is bzip2's block size, 1..9 (×100 KB); 9 is
// bzip2's default.
async function bz2Bytes(u8, opts = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('bz2Bytes: expected Uint8Array');
  const level = typeof opts.level === 'number' ? Math.max(1, Math.min(9, opts.level | 0)) : 9;
  return _gcuBz2.compress(u8, level);
}

// Derive an inner filename for single-file .bz2 archives — strip '.bz2'
// (or '.tbz' / '.tbz2' → '.tar'). Mirrors gz.js / zst.js / xz.js.
function _bz2InnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.tbz2')) return sourceName.slice(0, -5) + '.tar';
  if (lower.endsWith('.tbz'))  return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.bz2'))  return sourceName.slice(0, -4);
  return sourceName;
}

// -- walk.js --

// VFS directory walker — recursively enumerates a tree into a flat list of
// `{ path, type, bytes }` entries with paths relative to the root.
//
// Used by archive.compress to build the entry map for ZIP / tar / tar.gz
// from a workspace directory. The output shape matches what zipSync /
// writeTar consume (after a final reduce to `{ path: bytes }`).
//
// VFS duck type: needs readdir, stat, readFile. Same surface as
// aggregateLicenses uses. Each method may be sync or return a Promise —
// we await both shapes uniformly.

async function _call(fn, ...args) {
  const r = fn(...args);
  return (r && typeof r.then === 'function') ? await r : r;
}

// Read the file at path as raw bytes. We MUST pass 'bytes' as the encoding
// here — most VFS backends (MemoryBackend, IDBBackend, CommentBackend) will
// otherwise call TextDecoder().decode() on Uint8Array contents and produce
// a string with U+FFFD substituted for every byte outside a valid UTF-8
// sequence. Encoding that string back to utf8 is lossy and silently
// corrupts binary files (compresses fine, extracts to garbage).
async function _readBytes(vfs, path) {
  try {
    const r = await _call(vfs.readFile.bind(vfs), path, 'bytes');
    if (r instanceof Uint8Array) return r;
    if (r && r.buffer && typeof r.byteLength === 'number') {
      return new Uint8Array(r.buffer, r.byteOffset || 0, r.byteLength);
    }
    // Some backends always return strings — treat as utf8 text. Lossy for
    // binary but matches the only sensible fallback for an ambiguous API.
    if (typeof r === 'string') return new TextEncoder().encode(r);
  } catch (e) {
    throw new Error(`walk: read ${path} failed: ${e.message || e}`);
  }
  throw new Error(`walk: read ${path} returned unsupported shape`);
}

// walkVfsTree(vfs, rootPath, opts?) → Promise<entries[]>
//
// rootPath may be a directory or a single file. For a directory, we recurse
// and return entries with paths relative to rootPath. For a file, we return
// one entry whose path is the file's basename.
//
// opts.filter: predicate ({ path, type }) → boolean. Excluded entries are
// neither recursed into nor emitted; truthy values are kept.
//
// opts.includeRootDirEntry: emit a leading `path: ''` directory entry for
// the root. Defaults to false — most archive formats don't need it and ZIP
// conventions vary.
async function walkVfsTree(vfs, rootPath, opts = {}) {
  if (!vfs || typeof vfs.readdir !== 'function' || typeof vfs.readFile !== 'function'
      || typeof vfs.stat !== 'function') {
    throw new TypeError('walkVfsTree: vfs must implement readdir, readFile, stat');
  }
  const filter = opts.filter || (() => true);
  const entries = [];

  const root = String(rootPath).replace(/\/+$/, '') || '/';
  const stRoot = await _call(vfs.stat.bind(vfs), root);
  if (!stRoot) throw new Error(`walk: root path does not exist: ${root}`);

  // Single-file root — emit just the file.
  if (stRoot.type === 'file') {
    const name = root.split('/').filter(Boolean).pop() || 'file';
    if (filter({ path: name, type: 'file' })) {
      entries.push({ path: name, type: 'file', bytes: await _readBytes(vfs, root) });
    }
    return entries;
  }

  if (stRoot.type !== 'directory') {
    throw new Error(`walk: root ${root} has unsupported type: ${stRoot.type}`);
  }

  // Directory root — recurse. `relPath` accumulates the path inside the
  // archive; rootPath stays separate so we don't leak the workspace
  // absolute path into the archive's entry names.
  async function recurse(absPath, relPath) {
    const names = (await _call(vfs.readdir.bind(vfs), absPath)) || [];
    // Sort for determinism — archive byte output is reproducible across runs.
    names.sort();
    for (const name of names) {
      const child = absPath === '/' ? `/${name}` : `${absPath}/${name}`;
      const childRel = relPath ? `${relPath}/${name}` : name;
      let st;
      try { st = await _call(vfs.stat.bind(vfs), child); } catch { continue; }
      if (!st) continue;

      if (st.type === 'directory') {
        if (!filter({ path: childRel, type: 'directory' })) continue;
        entries.push({ path: childRel + '/', type: 'directory', bytes: new Uint8Array(0) });
        await recurse(child, childRel);
      } else if (st.type === 'file') {
        if (!filter({ path: childRel, type: 'file' })) continue;
        entries.push({ path: childRel, type: 'file',
          bytes: await _readBytes(vfs, child) });
      }
      // Anything else (symlinks etc.) is skipped silently.
    }
  }

  if (opts.includeRootDirEntry) {
    entries.push({ path: '', type: 'directory', bytes: new Uint8Array(0) });
  }
  await recurse(root, '');
  return entries;
}

// Convenience: walk + reduce to a flat { path: bytes } object — the input
// shape that fflate's zipSync and our own writeTar accept directly.
// Directory entries are emitted as zero-byte values keyed with a trailing '/'.
async function buildEntryMap(vfs, rootPath, opts = {}) {
  const entries = await walkVfsTree(vfs, rootPath, opts);
  const map = {};
  for (const e of entries) map[e.path] = e.bytes;
  return map;
}

// -- writer.js --

// Streaming archive writer — call addFile(path, bytes) / addDirectory(path)
// incrementally, then close() to flush. Memory benefit over archive.compress
// is real for ZIP (fflate's Zip class compresses each entry as it's added)
// and for tar (header + data + padding emit immediately, source bytes can
// be released). tar.gz / tar.xz / tar.bz2 still buffer the tar stream and
// compress it at close — true streaming compression is a v0.2 enhancement.
//
// Sink semantics (single output file, not a directory):
//   - { vfs, path }   final bytes written at close()
//   - 'memory'        close() returns the Uint8Array directly
//   - WritableStream  chunks pushed as they're produced; closed at close()
//
// At dev time the fflate imports below resolve through ESM; at build time
// they're stripped and references land on the namespaced aliases declared
// after the vendored IIFEs (Zip, ZipDeflate, ZipPassThrough).






const _nowSec = () => Math.floor(Date.now() / 1000);

// Helper: emit `chunk` to the destination — memory buffer / writable stream
// / VFS-deferred buffer. Same abstraction used by all format-specific
// writers below.
class _ChunkSink {
  constructor(sink) {
    this.sink = sink;
    this.chunks = [];        // for buffered sinks (memory, vfs)
    this.totalLen = 0;
    this._streamWriter = null;
    this._closed = false;

    if (typeof WritableStream !== 'undefined' && sink instanceof WritableStream) {
      this._streamWriter = sink.getWriter();
    }
  }
  async push(chunk) {
    if (this._closed) throw new Error('writer: push after close');
    if (this._streamWriter) {
      await this._streamWriter.write(chunk);
    } else {
      this.chunks.push(chunk);
      this.totalLen += chunk.length;
    }
  }
  async finalize() {
    if (this._closed) throw new Error('writer: close already called');
    this._closed = true;
    if (this._streamWriter) {
      await this._streamWriter.close();
      return undefined;   // stream sink owns the bytes
    }
    // Concat the accumulated chunks.
    const out = new Uint8Array(this.totalLen);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    this.chunks = null;

    if (this.sink === 'memory') return out;
    if (this.sink && typeof this.sink === 'object' && this.sink.vfs && typeof this.sink.path === 'string') {
      const r = this.sink.vfs.writeFile(this.sink.path, out);
      if (r && typeof r.then === 'function') await r;
      return { count: 1, paths: [this.sink.path] };
    }
    throw new TypeError('writer: sink must be { vfs, path } | "memory" | WritableStream');
  }
}

// ── ZIP writer ──────────────────────────────────────────────────────────
//
// fflate's Zip class is event-driven: you push files via .add(...), each
// file pushes its bytes via .push(bytes, final), and zip chunks come out
// of the top-level .ondata callback. Wire it to our ChunkSink.

class _ZipWriter {
  constructor(sink, opts) {
    this._sink = new _ChunkSink(sink);
    this._z = new Zip();
    this._z.ondata = (err, chunk, final) => {
      if (err) { this._pendingError = err; return; }
      if (chunk && chunk.length > 0) {
        // ondata is sync, but our sink.push is async. Queue the work via
        // _writePromise so addFile/close can await it.
        const p = this._sink.push(chunk).catch((e) => { this._pendingError = e; });
        this._writePromise = this._writePromise
          ? this._writePromise.then(() => p) : p;
      }
    };
    this._writePromise = null;
    this._pendingError = null;
    this._level = (opts && typeof opts.level === 'number')
      ? Math.max(0, Math.min(9, opts.level | 0)) : 6;
  }

  async addFile(path, bytes, opts) {
    if (this._pendingError) throw this._pendingError;
    const buf = bytes instanceof Uint8Array ? bytes
      : (typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes));
    // Per-file level override falls back to the writer-wide level.
    // level=0 → STORE (no compression); else DEFLATE at that level.
    // EPUB needs this: mimetype MUST be stored, everything else deflated.
    const lvl = (opts && typeof opts.level === 'number')
      ? Math.max(0, Math.min(9, opts.level | 0))
      : this._level;
    const file = lvl === 0
      ? new ZipPassThrough(path)
      : new ZipDeflate(path, { level: lvl });
    this._z.add(file);
    file.push(buf, true);   // single-shot — all bytes for this file at once
    if (this._writePromise) await this._writePromise;
    if (this._pendingError) throw this._pendingError;
  }

  async addDirectory(path) {
    if (!path.endsWith('/')) path = path + '/';
    // fflate emits a directory entry from a ZipPassThrough with no data.
    const dir = new ZipPassThrough(path);
    this._z.add(dir);
    dir.push(new Uint8Array(0), true);
    if (this._writePromise) await this._writePromise;
    if (this._pendingError) throw this._pendingError;
  }

  async close() {
    if (this._pendingError) throw this._pendingError;
    this._z.end();
    if (this._writePromise) await this._writePromise;
    if (this._pendingError) throw this._pendingError;
    return this._sink.finalize();
  }
}

// ── tar writer ──────────────────────────────────────────────────────────
//
// True streaming: header + data + padding emit to the sink the moment
// addFile returns. close() pushes the 1024-byte end-of-archive marker.
// Building the header from scratch here would duplicate the implementation
// in tar.js, so we call writeTar with one entry at a time and SLICE OFF
// the end-of-archive marker, then emit a fresh marker only at close().

const _TAR_TRAILER = new Uint8Array(1024);  // shared zero-bytes block

class _TarWriter {
  constructor(sink) {
    this._sink = new _ChunkSink(sink);
  }

  async addFile(path, bytes) {
    const buf = bytes instanceof Uint8Array ? bytes
      : (typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes));
    // writeTar({ path: bytes }) emits header + data (rounded to 512) + 1024
    // zero bytes. Drop the trailer; we emit it once at close().
    const full = writeTar({ [path]: buf });
    await this._sink.push(full.subarray(0, full.length - 1024));
  }

  async addDirectory(path) {
    if (!path.endsWith('/')) path = path + '/';
    const full = writeTar({ [path]: new Uint8Array(0) });
    await this._sink.push(full.subarray(0, full.length - 1024));
  }

  async close() {
    await this._sink.push(_TAR_TRAILER);
    return this._sink.finalize();
  }
}

// ── tar.gz writer ───────────────────────────────────────────────────────
//
// For v0.1: buffer the tar stream in memory, gzip it at close. This still
// gives the memory-saving "release input bytes after addFile" benefit, but
// the output isn't true-streaming. A future enhancement can wire
// CompressionStream incrementally for true streaming gzip.

// tar.gz / tar.xz / tar.bz2: the tar stream buffered, compressed whole at close().
class _TarCompressedWriter {
  constructor(sink, encode) {
    this._inner = new _TarWriter('memory');
    this._sink = sink;
    this._encode = encode;
  }
  addFile(path, bytes)  { return this._inner.addFile(path, bytes); }
  addDirectory(path)    { return this._inner.addDirectory(path); }
  async close() {
    const tarBytes = await this._inner.close();   // Uint8Array
    const packed = await this._encode(tarBytes);
    const out = new _ChunkSink(this._sink);
    await out.push(packed);
    return out.finalize();
  }
}

// ── Public ──────────────────────────────────────────────────────────────

function createWriter(sink, opts = {}) {
  if (!sink) throw new TypeError('createWriter: sink required');
  const format = opts.format;
  if (!format) throw new TypeError('createWriter: opts.format required (zip | tar | tar.gz | tar.xz | tar.bz2)');
  if (format === 'zip')     return new _ZipWriter(sink, opts);
  if (format === 'tar')     return new _TarWriter(sink);
  if (format === 'tar.gz')  return new _TarCompressedWriter(sink, (b) => gzipBytes(b));
  if (format === 'tar.xz')  return new _TarCompressedWriter(sink, (b) => xzBytes(b, opts));
  if (format === 'tar.bz2') return new _TarCompressedWriter(sink, (b) => bz2Bytes(b, opts));
  if (format === 'tar.zst') {
    throw new Error('createWriter: tar.zst encode not available (fzstd is decode-only)');
  }
  const single = { gz: 'gzip', zst: 'zstd', xz: 'xz', bz2: 'bzip2' }[format];
  if (single) {
    throw new Error(`createWriter: ${format} is a single-stream format — use archive.${single} for that`);
  }
  throw new Error(`createWriter: unsupported format '${format}'`);
}

// -- api.js --

// Public surface for @gcu/archive.
//
// Shipped this commit (foundation — ZIP read only):
//   archive.list(source)              → entries[]
//   archive.read(source, innerPath)   → Uint8Array | null
//   archive.extract(source, sink, opts?) → { count, paths }
//   archive.detect(source)            → 'zip' | 'tar' | ... | null
//
// Forthcoming:
//   archive.compress(source, sink, opts)     — write ZIP/tar/tar.gz/tar.zst
//   archive.stream(source)                   — async iterable of entries
//   archive.gzip / gunzip / zstd / unzstd    — single-file helpers
//   tar / tar.gz / tar.zst dispatch          — tar.js + gz.js + zst.js wiring
//
// Format dispatch: detectFormat(bytes) is authoritative; falls back to
// magicForFormat(name) when the source had a filename hint. Compound formats
// like `.tar.gz` won't be handled here — tar.js will own the pipeline once
// it lands; today's ZIP-only impl returns a clear error for unsupported types.













async function _resolveSourceFormat(src) {
  const bytes = await src.bytes();
  const detected = detectFormat(bytes);
  if (detected) return { bytes, format: detected, name: src.name };
  if (src.name) {
    const hinted = magicForFormat(src.name);
    if (hinted) return { bytes, format: hinted, name: src.name };
  }
  throw new Error('archive: could not detect format (no magic bytes match, no extension hint)');
}

// Peel off one gzip wrapper and re-detect the inner payload. Returns the
// same { bytes, format, name } shape as _resolveSourceFormat. For tar.gz
// the inner is 'tar'; for a single-file gzip of a CSV the inner is null
// (no archive format) and we report 'gz' as a single-entry container.
async function _unwrapGz(bytes, name) {
  const inner = await gunzipBytes(bytes);
  const innerFormat = detectFormat(inner);
  const innerName = _gzInnerName(name);
  if (innerFormat) return { bytes: inner, format: innerFormat, name: innerName };
  return { bytes: inner, format: 'gz-single', name: innerName, innerName };
}

// Same shape as _unwrapGz but for zstd. Single-file .zst payloads land
// as `zst-single`; .tar.zst unwraps to tar.
async function _unwrapZst(bytes, name) {
  const inner = await unzstdBytes(bytes);
  const innerFormat = detectFormat(inner);
  const innerName = _zstInnerName(name);
  if (innerFormat) return { bytes: inner, format: innerFormat, name: innerName };
  return { bytes: inner, format: 'zst-single', name: innerName, innerName };
}

// Same shape as _unwrapGz but for xz.
async function _unwrapXz(bytes, name) {
  const inner = await unxzBytes(bytes);
  const innerFormat = detectFormat(inner);
  const innerName = _xzInnerName(name);
  if (innerFormat) return { bytes: inner, format: innerFormat, name: innerName };
  return { bytes: inner, format: 'xz-single', name: innerName, innerName };
}

// Same shape as _unwrapGz but for bzip2.
async function _unwrapBz2(bytes, name) {
  const inner = await unbz2Bytes(bytes);
  const innerFormat = detectFormat(inner);
  const innerName = _bz2InnerName(name);
  if (innerFormat) return { bytes: inner, format: innerFormat, name: innerName };
  return { bytes: inner, format: 'bz2-single', name: innerName, innerName };
}

// Resolve a source to bytes + format, peeling off any outer gz/zst/xz/bz2
// wrapper so the caller can dispatch on the inner archive format uniformly.
async function _peelCompression(src) {
  const resolved = await _resolveSourceFormat(src);
  if (resolved.format === 'gz' || resolved.format === 'tar.gz') {
    return _unwrapGz(resolved.bytes, resolved.name);
  }
  if (resolved.format === 'zst' || resolved.format === 'tar.zst') {
    return _unwrapZst(resolved.bytes, resolved.name);
  }
  if (resolved.format === 'xz' || resolved.format === 'tar.xz') {
    return _unwrapXz(resolved.bytes, resolved.name);
  }
  if (resolved.format === 'bz2' || resolved.format === 'tar.bz2') {
    return _unwrapBz2(resolved.bytes, resolved.name);
  }
  return resolved;
}

// Write a single decompressed payload into a directory-shaped sink, applying
// the overwrite policy. Shared by gz-single and zst-single extract paths.
async function _extractSingle(dst, innerName, bytes, opts) {
  const overwrite = (opts && opts.overwrite) || 'error';
  let target = innerName;
  if (await dst.exists(target)) {
    if (overwrite === 'error') throw new Error(`extract: destination exists — ${target}`);
    if (overwrite === 'skip')  return { count: 0, paths: [] };
    if (overwrite === 'rename') target = await autoRename(dst, target);
  }
  await dst.writeFile(target, bytes);
  return { count: 1, paths: [target] };
}

function _explainUnsupported(format) {
  return `archive: unsupported format '${format}'`;
}

const archive = {
  // detect — peek at a source without reading the whole thing into memory
  // unnecessarily. For a small archive (or any in-memory bytes) it's cheap;
  // for a large stream it still has to drain to inspect the magic bytes.
  async detect(source) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    return detectFormat(bytes) || (src.name && magicForFormat(src.name)) || null;
  },

  async list(source) {
    const src = normalizeSource(source);
    const resolved = await _peelCompression(src);
    const { bytes, format } = resolved;
    if (format === 'zip') return listZip(bytes);
    if (format === 'tar') return listTar(bytes);
    if (format === 'gz-single' || format === 'zst-single' || format === 'xz-single' || format === 'bz2-single') {
      return [{ path: resolved.innerName, type: 'file', size: bytes.length }];
    }
    throw new Error(_explainUnsupported(format));
  },

  async read(source, innerPath) {
    if (typeof innerPath !== 'string' || !innerPath) {
      throw new TypeError('archive.read: innerPath must be a non-empty string');
    }
    const src = normalizeSource(source);
    const resolved = await _peelCompression(src);
    const { bytes, format } = resolved;
    if (format === 'zip') return readZip(bytes, innerPath);
    if (format === 'tar') return readTar(bytes, innerPath);
    if (format === 'gz-single' || format === 'zst-single' || format === 'xz-single' || format === 'bz2-single') {
      return innerPath === resolved.innerName ? bytes : null;
    }
    throw new Error(_explainUnsupported(format));
  },

  async extract(source, sink, opts) {
    const src = normalizeSource(source);
    const dst = normalizeSink(sink);
    const resolved = await _peelCompression(src);
    const { bytes, format } = resolved;
    let result;
    if (format === 'zip')      result = await extractZip(bytes, dst, opts);
    else if (format === 'tar') result = await extractTar(bytes, dst, opts);
    else if (format === 'gz-single' || format === 'zst-single' || format === 'xz-single' || format === 'bz2-single') {
      result = await _extractSingle(dst, resolved.innerName, bytes, opts);
    }
    else throw new Error(_explainUnsupported(format));
    if (dst.kind === 'memory') return dst.result();
    return result;
  },

  // Write side. Builds a ZIP / tar / tar.gz from a VFS directory (walked
  // recursively) or a flat `{ name: bytes }` entry map. Single-file gz /
  // zst / xz / bz2 formats route through archive.gzip / zstd / xz / bzip2.
  //
  // source:
  //   - { vfs, path: '/dir' }        — walk recursively, archive entries
  //     are paths relative to that dir
  //   - { vfs, path: '/file' }       — single file, archive contains the
  //     file under its basename
  //   - { name: bytes, ... }         — entries provided directly (advanced)
  //   - Uint8Array                   — only valid with format 'gz' (single
  //     stream compress)
  //
  // sink:
  //   - { vfs, path: '/out.zip' }    — file path; bytes written there
  //   - 'memory'                     — returns the raw archive bytes
  //     wrapped in a 1-key Map keyed by the sink-derived name
  //
  // opts.format: explicit format override; otherwise inferred from sink path.
  // opts.filter: predicate(entry) excluding paths during walk.
  // opts.level: deflate level for ZIP (0-9), the preset for xz / tar.xz (0-9),
  // the block size for bz2 / tar.bz2 (1-9); opts.extreme: xz's -e. tar / gz pick their own.
  async compress(source, sink, opts = {}) {
    const format = opts.format || _formatFromSinkPath(sink);
    if (!format) {
      throw new Error(
        'archive.compress: format required — pass opts.format or use a sink path ' +
        'with a recognized extension (.zip, .tar, .tar.gz, .gz, …)');
    }

    // Single-stream gz / zst paths: read source as bytes, compress one shot.
    if (format === 'gz') return this.gzip(source, sink);
    if (format === 'zst') return this.zstd(source, sink);
    if (format === 'xz') return this.xz(source, sink, opts);
    if (format === 'bz2') return this.bzip2(source, sink, opts);

    // tar.zst is decode-only (fzstd has no encoder). Be explicit so users
    // don't think it silently no-op'd.
    if (format === 'tar.zst') {
      throw new Error('archive.compress: tar.zst encode not available (fzstd is decode-only)');
    }

    // Multi-entry formats. Gather entries, build the archive, write it out.
    const filter = opts.filter || null;
    const entryMap = await _gatherEntries(source, filter);
    let archiveBytes;
    if (format === 'zip')         archiveBytes = zipSync(entryMap, _zipOptsFor(opts));
    else if (format === 'tar')    archiveBytes = writeTar(entryMap);
    else if (format === 'tar.gz') archiveBytes = await gzipBytes(writeTar(entryMap));
    else if (format === 'tar.xz') archiveBytes = await xzBytes(writeTar(entryMap), opts);
    else if (format === 'tar.bz2') archiveBytes = await bz2Bytes(writeTar(entryMap), opts);
    else throw new Error(_explainUnsupported(format));

    const fallbackName = _sinkBasename(sink) || ('archive.' + format);
    return _writeSingle(sink, archiveBytes, fallbackName);
  },

  // Single-file gzip helpers. Sink semantics differ from extract's: the
  // sink's `path` (when vfs) is the OUTPUT FILE, not a destination directory
  // — gunzip writes one byte stream, not many entries. memory sink returns
  // a one-key Map keyed by the derived inner name.
  async gzip(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const compressed = await gzipBytes(bytes);
    return _writeSingle(sink, compressed, (src.name || 'data') + '.gz');
  },

  async gunzip(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const inner = await gunzipBytes(bytes);
    return _writeSingle(sink, inner, _gzInnerName(src.name));
  },

  // Single-file zstd helpers. Encode path throws — fzstd is decode-only.
  // (When the encoder gets vendored, zstdBytes lights up and this works.)
  async zstd(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const compressed = await zstdBytes(bytes);
    return _writeSingle(sink, compressed, (src.name || 'data') + '.zst');
  },

  async unzstd(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const inner = await unzstdBytes(bytes);
    return _writeSingle(sink, inner, _zstInnerName(src.name));
  },

  // Single-file xz helpers. opts.level is the preset (0..9, default 6),
  // opts.extreme is `xz -e`.
  async xz(source, sink, opts = {}) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const compressed = await xzBytes(bytes, opts);
    return _writeSingle(sink, compressed, (src.name || 'data') + '.xz');
  },

  async unxz(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const inner = await unxzBytes(bytes);
    return _writeSingle(sink, inner, _xzInnerName(src.name));
  },

  // Single-file bzip2 helpers. opts.level is the block size (1..9, default 9).
  async bzip2(source, sink, opts = {}) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const compressed = await bz2Bytes(bytes, opts);
    return _writeSingle(sink, compressed, (src.name || 'data') + '.bz2');
  },

  async bunzip2(source, sink) {
    const src = normalizeSource(source);
    const bytes = await src.bytes();
    const inner = await unbz2Bytes(bytes);
    return _writeSingle(sink, inner, _bz2InnerName(src.name));
  },

  // Streaming writer — call addFile / addDirectory / close incrementally
  // instead of materialising the whole entry map in memory before encoding.
  // See src/writer.js for the per-format details.
  createWriter,
};

// Write a single byte stream to whatever shape of sink the caller passed.
// Used by archive.gzip and archive.gunzip; bypasses normalizeSink because
// the directory-shaped semantics there don't fit single-file destinations.
async function _writeSingle(sink, bytes, defaultName) {
  if (sink === 'memory') {
    const m = new Map();
    m.set(defaultName, bytes);
    return m;
  }
  if (sink && typeof sink === 'object' && sink.vfs && typeof sink.path === 'string') {
    const r = sink.vfs.writeFile(sink.path, bytes);
    if (r && typeof r.then === 'function') await r;
    return { count: 1, paths: [sink.path] };
  }
  throw new TypeError('sink: single-file helpers expect { vfs, path: <file> } or "memory"');
}

// Infer the output format from the sink's file path extension. Used as the
// fallback when opts.format isn't specified — matches the spec's promise
// that `archive.compress({vfs,path:'a'}, {vfs,path:'a.tar.gz'})` Just Works.
function _formatFromSinkPath(sink) {
  if (sink && typeof sink === 'object' && typeof sink.path === 'string') {
    return magicForFormat(sink.path);
  }
  return null;
}

function _sinkBasename(sink) {
  if (sink && typeof sink === 'object' && typeof sink.path === 'string') {
    return sink.path.split('/').pop();
  }
  return null;
}

// Map opts.level (0..9 or undefined) onto fflate's zipSync options shape.
function _zipOptsFor(opts) {
  const o = {};
  if (typeof opts.level === 'number') o.level = Math.max(0, Math.min(9, opts.level | 0));
  return o;
}

// Build a `{ path: bytes }` entry map from one of the supported compress
// source shapes. VFS-backed sources walk via walkVfsTree; plain objects
// pass through after byte-coercing values; Uint8Array isn't accepted here
// (single-file gz/zst/xz/bz2 takes a different path in compress() above).
async function _gatherEntries(source, filter) {
  // VFS source — directory or single file.
  if (source && typeof source === 'object' && source.vfs && typeof source.path === 'string') {
    const entries = await walkVfsTree(source.vfs, source.path, filter ? { filter } : {});
    const map = {};
    for (const e of entries) map[e.path] = e.bytes;
    return map;
  }
  // Plain entry object — { 'a/b.txt': bytes-or-string, ... }
  if (source && typeof source === 'object' && !(source instanceof Uint8Array)) {
    const map = {};
    for (const [k, v] of Object.entries(source)) {
      if (filter && !filter({ path: k, type: k.endsWith('/') ? 'directory' : 'file' })) continue;
      if (v instanceof Uint8Array) map[k] = v;
      else if (typeof v === 'string') map[k] = new TextEncoder().encode(v);
      else if (v && v.buffer) map[k] = new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
      else map[k] = new Uint8Array(0);
    }
    return map;
  }
  throw new TypeError(
    'archive.compress: source must be { vfs, path } or a flat { path: bytes } object ' +
    '(single-stream compress goes through archive.gzip / zstd / xz / bzip2)');
}
export {
  detectFormat, magicForFormat,
  normalizeSource, normalizeSink,
  listZip, readZip,
  listTar, readTar, writeTar,
  gunzipBytes, gzipBytes,
  unzstdBytes, zstdBytes,
  unxzBytes, xzBytes,
  unbz2Bytes, bz2Bytes,
  walkVfsTree, buildEntryMap,
  createWriter,
  archive,
};
