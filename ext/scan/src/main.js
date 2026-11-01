// @gcu/scan — kernels over a block model's records, columnar and parallel, never
// resident. The page bundle (index.js). The worker bundle is worker-main.js →
// worker.js. Both have zero imports: libraries are injected (createScan).
export { createScan } from './api.js';
export { defaultPoolSize, groupStarts } from './pool.js';
export { makeColAcc, STAT_SLICE } from './colacc.js';
export { chunkView, compileCalcs, chunkNumbers } from './chunkview.js';
export {
  GT_BINS_TARGET, GT_BINS_CAP, gtEdge, gtBinOf, gtAccumulator, gtAbove, gtCuts, gtKernel, gtPartial, gtMerge,
  swathKernel, swathMerge, momentAdd, momentMerge, momentStd, statsKernel, statsMerge,
  XTAB_GROUPS_CAP, xtabSlot, xtabAdd, xtabKey, crosstabKernel, crosstabMerge,
  scatterAccumulator, scatterAdd, scatterMerge, scatterR, scatterKernel,
  filterKernel, valuesKernel, positionsKernel,
} from './kernels.js';
