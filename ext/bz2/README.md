# @gcu/bz2

bzip2 in plain JavaScript, both directions. It is libbzip2 1.0.8 ported line for line, not a
reimplementation. So:

- **the streams it writes are byte-identical** to the `bzip2` tool's, libbzip2's and CPython's
  `bz2`. That includes the Burrows–Wheeler sort's order for equal rotations, which a different
  correct sort would change.
- **it reads them as libbzip2 does**: streamed, with `maxLength`, `needsInput` and
  `unusedData` meaning what they mean in libbzip2 (and in CPython's `BZ2Decompressor`, which
  wraps it). It also reads the randomised blocks older bzip2 versions wrote.

No WebAssembly, no dependencies. About 58 KB, or 16 KB gzipped.

```js
import { compress, decompress, Compressor, Decompressor } from '@gcu/bz2';

const z = compress(bytes, 9);          // a .bz2 stream (level 1–9: the block size, ×100k)
const back = decompress(z);            // one or more concatenated streams

const c = new Compressor(9);
const parts = [c.compress(chunk1), c.compress(chunk2), c.flush()];

const d = new Decompressor();
const out = d.decompress(input, 65536);   // at most 64 KiB; the rest stays inside
d.eof; d.needsInput; d.unusedData;        // as CPython's BZ2Decompressor
```

| | |
|---|---|
| `compress(data, level = 9)` | the whole stream |
| `decompress(data)` | stream after stream, as CPython's `bz2.decompress`. Bytes after a stream that aren't another stream are ignored; a stream cut short throws |
| `new Compressor(level = 9, workFactor = 0)` | `.compress(bytes)` returns the bytes completed so far, which may be none until a block fills. `.flush()` returns the rest; after it the compressor is finished |
| `new Decompressor()` | `.decompress(bytes, maxLength = -1)`, `.eof`, `.needsInput`, `.unusedData` |
| `BzDataError` | thrown for a corrupt stream. `.magic` is true when it isn't bzip2 at all |

`test/bz2.test.mjs` checks the bytes against CPython 3.13's `bz2.compress` (by SHA-256) across
these shapes:

- empty input and runs;
- periodic blocks big enough to send the main sort to its fallback;
- random, low-entropy and multi-block data;
- streamed, chunked and `maxLength` decoding;
- concatenated streams;
- a randomised block;
- corruption.

Adder's `_bz2` module is built on it, under CPython's own `bz2.py`.

## License

The original's: `bzip2-1.0.6`, the license bzip2 1.0.8 is under. This is an altered version
of bzip2/libbzip2 (copyright © 1996–2019 Julian R Seward). See `LICENSE`.
