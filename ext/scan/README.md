# @gcu/scan

Kernels over a block model's records, columnar and parallel, never resident.
The kernels are grade-tonnage, swath, statistics, filter, values and positions.

A model is read in **units**:
- Parquet row groups;
- Datamine `.dm` page runs, with only the needed fields decoded by striding;
- runs of an indexed delimited file, which can skip whole zones by their zone maps.

Each unit becomes one job on a pool of module workers. Where workers can't run (`file://`, an old browser), it runs on the page instead, with the same kernel over the same chunk view. Partials merge in unit order, so the answer never depends on where a unit ran.

This is the engine behind micro's analysis windows, filter, colour-by texture, column statistics, and its Parquet open (discovery, the lattice check, the render decode).

## Zero imports

Neither bundle imports anything:
- the page bundle (`index.js`) is given its libraries;
- the worker bundle (`worker.js`) is given their **URLs** when a worker starts, because a module worker created from a blob has no import map.

So the package drops into a registry/blob build or a plain directory unchanged, and Node tests it by injection.

```js
import { createScan } from '@gcu/scan';
const scan = createScan({
  deps: { parquet, condenser, expr, sluice },                     // the modules, for the page
  urls: { worker, parquet, condenser, expr, sluice },             // where a worker imports them
});
```

Without `urls.worker`, or without `Worker`, every job runs on the page.

## Running a scan

```js
const src = scan.sources.parquet({ buf, meta, names, rowGroups }, readCols);
// or scan.sources.delimited(blob, header, readerOpts, readCols, { anchors, keep })
// or scan.sources.dm(blob, dmHeader, names, readCols)
const { parts, where, skipped, zonesSkipped } = await scan.run({
  source: src, kernel: 'filter', params: { schema, expr: 'AU > 1', coords: ['X', 'Y', 'Z'] },
  spec: { base: readCols, paints: [] }, calcs: [], readCols,
  page: null, mask: null, onPart: null, onProgress, signal,
});
```

The caller plans the job:
- `readCols`: the columns to read, and only those;
- `spec`: the chunk view;
- `calcs`: calculated columns, in evaluation order;
- `page(start, count)`: slices of any columns the caller holds in memory.

`onPart` hands partials over in unit order, with backpressure.

- **Zone skipping:** `scan.zoneKeep(header.zones, { ast, names, bbox, coords, mask })` gives a `keep(z)` for the delimited source. It is sound under every qualifier policy: condenser's zone maps widen for `<x`, `>x` and negative codes.
- **Parquet open jobs:** `discoverParquet`, `checkLattice`, `decodeParquet`, `parquetStats`.
- **Running tasks on the page:** `discoverGroup` and `decodeGroup` are exported for a page that runs them itself.

## Build

```
node ext/scan/build.js        # → index.js + worker.js
node --test test/scan.test.mjs test/scan-kernels.test.mjs
```

MIT.
