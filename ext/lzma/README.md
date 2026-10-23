# @gcu/lzma

xz / LZMA in plain JavaScript, both directions. It is liblzma 5.8.1 (XZ Utils) ported, not a
reimplementation. So:

- **what it writes is byte-identical** to what liblzma writes, which means the `xz` tool and
  CPython's `lzma`. That covers every preset 0–9 and their extreme variants, `.xz`, `.lzma` and
  raw streams, the CRC32, CRC64 and SHA-256 checks, every LZMA option and match finder, and the
  delta and branch filters (x86, PowerPC, IA-64, ARM, ARM-Thumb, ARM64, SPARC, RISC-V). This is
  because the match finders and the optimal parser make liblzma's choices.
- **it reads them as liblzma does**: streamed, with `maxLength`, `needsInput`, `unusedData`
  and `check` meaning what they mean in CPython's `LZMADecompressor`. That holds even when the
  input stops in the middle of a symbol.

No WebAssembly, no dependencies. About 145 KB, or 34 KB gzipped.

```js
import { compress, decompress, Compressor, Decompressor, FILTER_X86, FILTER_LZMA2 } from '@gcu/lzma';

const xz = compress(bytes);                                   // .xz, preset 6, CRC64
const lz = compress(bytes, { format: 'alone', preset: 9 });   // .lzma
const bcj = compress(exe, { filters: [{ id: FILTER_X86 }, { id: FILTER_LZMA2, preset: 6 }] });
const back = decompress(xz);                                  // .xz or .lzma; concatenated too

const d = Decompressor();                    // format: 'auto' | 'xz' | 'alone' | 'raw'
const out = d.decompress(input, 65536);      // at most 64 KiB; the rest stays inside
d.eof; d.needsInput; d.unusedData; d.check;
```

The formats:

- `'xz'` is the default for compressing.
- `'auto'` is the default for decompressing: `.xz` or `.lzma`, judged by the first byte.
- `'alone'` is `.lzma`.
- `'raw'` needs `filters`.

A filter is `{ id, ...options }`:

| filter | options |
|---|---|
| `FILTER_LZMA2` / `FILTER_LZMA1` | `preset`, `dictSize`, `lc`, `lp`, `pb`, `mode` (`'fast'` or `'normal'`), `niceLen`, `mf` (`MF_HC3` … `MF_BT4`), `depth` |
| `FILTER_DELTA` | `dist` |
| the branch filters | `start_offset` |

What `test/lzma.test.mjs` checks:

- **Compression:** 27 configurations against CPython 3.13's `lzma.compress`, and the ARM64 and
  RISC-V filters (which CPython's `lzma` doesn't offer) against the xz tool 5.8.3. Each is
  compared by SHA-256, with the input fed in pieces.
- **Decompression:** fed 7 bytes at a time, and by `maxLength` with `unusedData`.
- **Streams:** concatenated, and with trailing garbage.
- **Errors:** corruption, `memlimit`, and 400 mutated streams, each of which ends in data or an
  `LzmaError`.

Adder's `_lzma` module is built on it, under CPython's own `lzma.py`.

## License

MIT. It is ported from liblzma, which is under the BSD Zero Clause License (0BSD); see `LICENSE`.
