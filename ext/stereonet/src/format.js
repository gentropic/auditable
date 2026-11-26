// @gcu/stereonet — attitudes as text, one way for every GCU surface: planes as dip direction/dip ("045/72"),
// lines as trend→plunge ("045→32", the way wuffle's field compass reads typed lines). Whole degrees;
// azimuths three digits, dips and plunges two. (Decided 2026-11-26; micro's measure readout follows.)

const az = (v) => String(((Math.round(v) % 360) + 360) % 360).padStart(3, '0');
const dp = (v) => String(Math.round(v)).padStart(2, '0');

/** [dipDirection, dip] → "045/72" */
export const formatPlane = ([dd, dip]) => `${az(dd)}/${dp(dip)}`;
/** [trend, plunge] → "045→32" */
export const formatLine = ([trend, plunge]) => `${az(trend)}→${dp(plunge)}`;
