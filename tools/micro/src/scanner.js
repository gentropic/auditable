// micro scanner — THE scanner (@gcu/scan), built once: its libraries injected for
// the page, their URLs for the workers (liburl.js — a blob URL in the built
// file, a dev-tree path here). Everything that scans a model's records — the
// analysis windows, the filter, the colour-by texture, column statistics, a
// Parquet open's discovery and decode — goes through this one instance.
import * as parquet from '../../../ext/parquet/index.js';
import * as condenser from '../../../ext/condenser/src/main.js';
import * as expr from '../../../ext/expr/index.js';
import * as sluice from '../../../ext/sluice/index.js';
import { createScan } from '../../../ext/scan/src/main.js';
import { libUrl } from './liburl.js';

export const scan = createScan({
  deps: { parquet, condenser, expr, sluice },
  urls: {
    worker: libUrl('scan-worker', '../../../ext/scan/src/worker-main.js'),
    parquet: libUrl('parquet', '../../../ext/parquet/index.js'),
    condenser: libUrl('condenser', '../../../ext/condenser/src/main.js'),
    expr: libUrl('expr', '../../../ext/expr/index.js'),
    sluice: libUrl('sluice', '../../../ext/sluice/index.js'),
  },
});
export {
  defaultPoolSize, groupStarts, makeColAcc, STAT_SLICE, chunkView, compileCalcs, chunkNumbers,
  gtAccumulator, gtAbove, gtCuts, gtMerge, swathMerge, statsMerge, momentAdd, momentMerge, momentStd,
} from '../../../ext/scan/src/main.js';
