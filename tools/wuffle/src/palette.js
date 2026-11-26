// wuffle's DATA colours (a layer's colour), not UI accents: mid-tones that read on basalt and on equipment gray.
// A new layer takes the next one, so the tree's swatch and the net always agree.
export const PALETTE = ['#e07a5f', '#3f97cc', '#7fae2e', '#b56fd0', '#d9a321', '#2fa891'];
export const nextColor = (n) => PALETTE[n % PALETTE.length];
