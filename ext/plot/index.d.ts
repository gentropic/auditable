// @gcu/plot — types. matplotlib's API in JS: keyword arguments are a trailing options object.
// The prose reference is API.md (also llms.txt).

export type Column = ArrayLike<number> | Iterable<number>;
export type Labels = ArrayLike<string> | string[];
export type Grid2D = ArrayLike<ArrayLike<number>> | { data: ArrayLike<number>; shape: [number, number] };
export type Color = string;
export type Cmap = string | ((t: number) => string) | string[] | ListedColormap | { name: string; N: number };
export type NormLike = Normalize | 'linear' | 'log';

export interface ArtistOpts { label?: string; alpha?: number; zorder?: number; color?: Color; c?: Color }
export interface LineOpts extends ArtistOpts {
  linestyle?: string; ls?: string; linewidth?: number; lw?: number; marker?: string;
  markersize?: number; ms?: number; markerfacecolor?: Color; markeredgecolor?: Color; drawstyle?: string; fmt?: string;
}
export interface MapOpts { cmap?: Cmap; norm?: NormLike; vmin?: number; vmax?: number }

/** What a chart returns: matplotlib's container, an array with fields; any other name reads the axes (chaining). */
export type Result<Items extends unknown[] = unknown[], Fields = {}> = Items & Fields & Axes & { axes: Axes };
export interface Line2D { get_xdata(): ArrayLike<number>; get_ydata(): ArrayLike<number>; get_color(): string; get_label(): string | null; axes: Axes }
export interface Bar { x: number; y: number; width: number; height: number; get_x(): number; get_y(): number; get_width(): number; get_height(): number }
export interface BoxStats { mean: number; med: number; q1: number; q3: number; iqr: number; whislo: number; whishi: number; cilo: number; cihi: number; fliers: number[]; label: string | null; n: number }

export interface ColorbarOpts { label?: string; ticks?: Column; format?: string | ((v: number) => string); extend?: 'neither' | 'min' | 'max' | 'both' }
export type Corner = 'lower right' | 'lower left' | 'upper right' | 'upper left';
export interface ViewRect { u0: number; u1: number; v0: number; v1: number }
export interface PatchOpts extends ArtistOpts { facecolor?: Color | 'none'; edgecolor?: Color | 'none'; linewidth?: number; linestyle?: string; fill?: boolean; closed?: boolean }
export interface Patch { get_facecolor(): string; get_edgecolor(): string; get_label(): string | null; get_xy(): [number, number][]; axes: Axes }
export interface ViewInfo { x: number; y: number; w: number; h: number; xScale: LinearScale | LogScale; yScale: LinearScale | LogScale; dpr: number }
export interface PickHit { axes: Axes; trace: object; traceIndex: number; kind: string; index: number; x: number; y: number; c: unknown; s: number | null; label: string | null; value?: number }

export class Axes {
  view: ViewInfo | null;
  figure: Figure;
  get_figure(): Figure | null;
  plot(y: Column, fmt?: string, opts?: LineOpts): Result<[Line2D]>;
  plot(x: Column | Labels, y: Column, fmt?: string | LineOpts, opts?: LineOpts): Result<[Line2D]>;
  scatter(x: Column | Labels, y: Column, opts?: ArtistOpts & MapOpts & { s?: number | Column; c?: Column | Color | Color[]; marker?: string; edgecolors?: Color; linewidths?: number }): Result;
  bar(x: Column | Labels, height: Column, opts?: ArtistOpts & { width?: number | Column; bottom?: number | Column; align?: 'center' | 'edge'; color?: Color | Color[]; edgecolor?: Color | Color[]; linewidth?: number; tick_label?: Labels }): Result<Bar[], { datavalues: ArrayLike<number> }>;
  barh(y: Column | Labels, width: Column, opts?: ArtistOpts & { height?: number | Column; left?: number | Column; align?: 'center' | 'edge'; color?: Color | Color[]; edgecolor?: Color | Color[] }): Result<Bar[], { datavalues: ArrayLike<number> }>;
  bar_label(container: Result, labels?: Labels | { fmt?: string | ((v: number) => string); padding?: number; label_type?: 'edge' | 'center'; color?: Color; fontsize?: number }, opts?: { fmt?: string | ((v: number) => string); padding?: number; label_type?: 'edge' | 'center'; color?: Color; fontsize?: number }): Result;
  hist(x: Column | Column[], opts?: ArtistOpts & { bins?: number | Column | 'auto' | 'fd' | 'sturges' | 'sqrt' | 'rice' | 'scott'; range?: [number, number]; weights?: Column | Column[]; density?: boolean; cumulative?: boolean; histtype?: 'bar' | 'barstacked' | 'step' | 'stepfilled'; orientation?: 'vertical' | 'horizontal'; stacked?: boolean; bottom?: number | Column; log?: boolean; rwidth?: number; align?: 'left' | 'mid' | 'right'; edgecolor?: Color; linewidth?: number }): Result<[Float64Array | Float64Array[], Float64Array, unknown[]]>;
  boxplot(x: Column | Column[] | Record<string, Column>, opts?: { whis?: number | [number, number]; labels?: Labels; tick_labels?: Labels; vert?: boolean; orientation?: 'vertical' | 'horizontal'; showfliers?: boolean; showmeans?: boolean; meanline?: boolean; widths?: number | Column; positions?: Column; patch_artist?: boolean; boxprops?: object; medianprops?: object; whiskerprops?: object; capprops?: object; flierprops?: object; meanprops?: object; manage_ticks?: boolean }): Result<[], { medians: Line2D[]; boxes: Line2D[]; whiskers: Line2D[]; caps: Line2D[]; fliers: Line2D[]; means: Line2D[]; stats: BoxStats[] }>;
  imshow(Z: Grid2D, opts?: ArtistOpts & MapOpts & { extent?: [number, number, number, number]; origin?: 'upper' | 'lower'; interpolation?: 'nearest' | 'bilinear'; aspect?: 'equal' | 'auto'; nodata?: number }): Result;
  imshow(data: Column, nx: number, ny: number, opts?: ArtistOpts & MapOpts & { extent?: [number, number, number, number]; origin?: 'upper' | 'lower'; interpolation?: 'nearest' | 'bilinear' }): Result;
  matshow(Z: Grid2D, opts?: MapOpts): Result;
  pcolormesh(C: Grid2D, opts?: MapOpts & ArtistOpts & { shading?: 'auto' | 'flat' | 'nearest'; edgecolors?: Color; linewidth?: number }): Result;
  pcolormesh(X: Column | Grid2D, Y: Column | Grid2D, C: Grid2D, opts?: MapOpts & ArtistOpts & { shading?: 'auto' | 'flat' | 'nearest'; edgecolors?: Color; linewidth?: number }): Result;
  contour(...args: Array<Column | Grid2D | number | Column | object>): Result<[], { levels: number[]; allsegs: Array<Array<[[number, number], [number, number]]>> }>;
  contourf(...args: Array<Column | Grid2D | number | Column | object>): Result<[], { levels: number[]; allsegs: Array<Array<[[number, number], [number, number]]>> }>;
  fill_between(x: Column, y1: Column | number, y2?: Column | number, opts?: ArtistOpts & { where?: ArrayLike<boolean>; step?: 'pre' | 'post' | 'mid'; facecolor?: Color; edgecolor?: Color }): Result;
  fill_betweenx(y: Column, x1: Column | number, x2?: Column | number, opts?: ArtistOpts & { where?: ArrayLike<boolean>; step?: 'pre' | 'post' | 'mid' }): Result;
  step(x: Column, y: Column, fmt?: string | (LineOpts & { where?: 'pre' | 'post' | 'mid' }), opts?: LineOpts & { where?: 'pre' | 'post' | 'mid' }): Result<[Line2D]>;
  errorbar(x: Column, y: Column, opts?: LineOpts & { yerr?: number | Column | [Column | number, Column | number]; xerr?: number | Column | [Column | number, Column | number]; ecolor?: Color; elinewidth?: number; capsize?: number }): Result<[Line2D | null, [], []]>;
  axhline(y?: number, opts?: LineOpts & { xmin?: number; xmax?: number }): Result;
  axvline(x?: number, opts?: LineOpts & { ymin?: number; ymax?: number }): Result;
  hlines(y: number | Column, xmin: number, xmax: number, opts?: LineOpts & { colors?: Color | Color[] }): this;
  vlines(x: number | Column, ymin: number, ymax: number, opts?: LineOpts & { colors?: Color | Color[] }): this;
  axhspan(ymin: number, ymax: number, opts?: ArtistOpts & { xmin?: number; xmax?: number; facecolor?: Color; edgecolor?: Color }): Result;
  axvspan(xmin: number, xmax: number, opts?: ArtistOpts & { ymin?: number; ymax?: number; facecolor?: Color; edgecolor?: Color }): Result;
  text(x: number, y: number, s: string, opts?: { transform?: 'axes' | 'data'; ha?: string; va?: string; fontsize?: number | string; rotation?: number | 'vertical'; fontweight?: 'bold' | 'normal'; color?: Color; alpha?: number; zorder?: number }): this;
  annotate(text: string, xy: [number, number], opts?: { xytext?: [number, number]; xycoords?: 'data' | 'axes fraction'; textcoords?: 'data' | 'axes fraction' | 'offset points' | 'offset pixels'; arrowprops?: { arrowstyle?: string; color?: Color; lw?: number; shrink?: number }; ha?: string; va?: string; fontsize?: number; color?: Color }): Result;

  set_title(text: string, opts?: object): this;
  set_xlabel(text: string, opts?: object): this;
  set_ylabel(text: string, opts?: object): this;
  set_xlim(left?: number | null | [number, number] | { left?: number; right?: number }, right?: number | null): this;
  set_ylim(bottom?: number | null | [number, number] | { bottom?: number; top?: number }, top?: number | null): this;
  get_xlim(): [number, number];
  get_ylim(): [number, number];
  invert_xaxis(): this;
  invert_yaxis(): this;
  xaxis_inverted(): boolean;
  yaxis_inverted(): boolean;
  set_xscale(s: 'linear' | 'log'): this;
  set_yscale(s: 'linear' | 'log'): this;
  set_xticks(ticks: Column, labels?: Labels | { rotation?: number }, opts?: { rotation?: number }): this;
  set_yticks(ticks: Column, labels?: Labels | { rotation?: number }, opts?: { rotation?: number }): this;
  set_xticklabels(labels: Labels, opts?: { rotation?: number }): this;
  set_yticklabels(labels: Labels, opts?: { rotation?: number }): this;
  get_xticks(): number[];
  get_yticks(): number[];
  tick_params(opts: { axis?: 'x' | 'y' | 'both'; labelrotation?: number }): this;
  margins(x?: number | { x?: number; y?: number }, y?: number): this | [number, number];
  axis(arg?: 'off' | 'on' | 'equal' | 'scaled' | 'image' | 'tight' | 'auto' | [number, number, number, number]): [number, number, number, number];
  set_aspect(aspect: 'equal' | 'auto'): this;
  grid(on?: boolean | object, opts?: { color?: Color; linestyle?: string; linewidth?: number; alpha?: number; axis?: 'x' | 'y' | 'both' }): this;
  legend(labels?: Labels | object, opts?: object): this;
  legend(handles: unknown[], labels: Labels, opts?: { loc?: string | number; bbox_to_anchor?: [number, number] | [number, number, number, number]; ncols?: number; title?: string; fontsize?: number | string; frameon?: boolean; framealpha?: number }): this;
  /** colorbar(mappable | ScalarMappable, opts) · colorbar({cmap, vmin, vmax, norm, …}): a bar with nothing of plot's behind it */
  colorbar(mappable?: Result | ScalarMappable | (ColorbarOpts & MapOpts), opts?: ColorbarOpts): Result;
  twinx(): Axes;
  twiny(): Axes;
  pick(px: number, py: number, opts?: { radius?: number }): PickHit | null;
  /** dim all but the chosen points of a scatter: indices, a boolean / Uint8Array mask, or (i, x, y) => bool; null clears */
  highlight(sel: ArrayLike<number> | ArrayLike<boolean> | ((i: number, x: number, y: number) => boolean) | null, opts?: { trace?: Result | number; dim?: number }): this;
  // plan views
  fill(...args: (Column | string | PatchOpts)[]): (Patch & { _trace: object })[];
  add_patch<P extends Polygon>(p: P): P;
  add_geometry(geojson: object, opts?: PatchOpts & { marker?: string; s?: number }): Result;
  scalebar(opts?: { units?: string; length?: number; loc?: Corner; color?: Color; label?: string }): this;
  north_arrow(opts?: { loc?: Corner; rotation?: number; size?: number; color?: Color }): this;
  // axes as chrome over another renderer
  set_facecolor(c: Color | 'none'): this;
  get_facecolor(): string;
  /** the limits another renderer's camera shows; also condenser's view rect */
  set_view(v: { xlim?: [number, number]; ylim?: [number, number]; rect?: ViewRect } | ViewRect): this;
  toPixel(x: number, y: number): [number, number];
  toData(px: number, py: number): [number, number];
}

export interface DrawList { version: number; width: number; height: number; facecolor: string; ops: unknown[][] }

export class Figure {
  axes: Axes[];
  width: number;
  height: number;
  dpi: number;
  facecolor: string;
  suptitle(text: string, opts?: object): this;
  colorbar(mappable: Result | ScalarMappable, opts?: ColorbarOpts & { ax?: Axes }): Result;
  set_theme(theme: string | Partial<Theme>): this;
  show(): HTMLCanvasElement | this;
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, opts?: { dpr?: number }): unknown;
  toDrawList(): DrawList;
  toPNG(opts?: { dpr?: number }): Promise<Uint8Array>;
  savefig(name?: string, opts?: { format?: 'png' | 'svg' }): unknown;
  /** an SVG string from the draw list; an export paints the theme background under a transparent figure unless facecolor is given */
  toSVG(opts?: { facecolor?: Color | null }): string;
  set_facecolor(c: Color | 'none'): this;
  get_facecolor(): string;
  axesAt(px: number, py: number): Axes | null;
  tight_layout(): this;
}

export interface SubplotsOpts { figsize?: [number, number]; dpi?: number; sharex?: boolean | 'all' | 'row' | 'col'; sharey?: boolean | 'all' | 'row' | 'col'; theme?: string | Partial<Theme>; facecolor?: Color; wspace?: number; hspace?: number; gap?: number; strict?: boolean }
/** the shape follows matplotlib's squeeze: 1 × 1 → an Axes, one row or column → Axes[], else Axes[][] (with .flat) */
export function subplots(opts?: SubplotsOpts): [Figure, Axes] & { fig: Figure; ax: Axes };
export function subplots(nrows: 1, ncols?: 1, opts?: SubplotsOpts): [Figure, Axes] & { fig: Figure; ax: Axes };
export function subplots(nrows: 1, ncols: number, opts?: SubplotsOpts): [Figure, Axes[]] & { fig: Figure; axes: Axes[] };
export function subplots(nrows: number, ncols?: 1, opts?: SubplotsOpts): [Figure, Axes[]] & { fig: Figure; axes: Axes[] };
export function subplots(nrows: number, ncols: number, opts?: SubplotsOpts): [Figure, Axes[][] & { flat: Axes[] }] & { fig: Figure; axes: Axes[][] & { flat: Axes[] } };

export interface Theme {
  background: string; figure: string; foreground: string; muted: string; grid: string; frame: string;
  panel: string; panel_border: string; accent: string; selection: string; halo: string;
  cycle: string[]; ramp: string; font: string; mono: string; font_size: number;
}
export function themeFromCSS(el: Element, map?: Partial<Record<keyof Theme, string>>): Theme;
export function resolveTheme(t?: string | Partial<Theme> & { base?: string }): Theme;

export class Normalize {
  constructor(vmin?: number | null, vmax?: number | null, clip?: boolean);
  vmin: number | null; vmax: number | null;
  call(v: number): number;
  inverse(t: number): number;
}
export class LogNorm extends Normalize {}
export class TwoSlopeNorm extends Normalize { constructor(vcenter: number, vmin?: number | null, vmax?: number | null) }
export class CenteredNorm extends Normalize { constructor(vcenter?: number, halfrange?: number | null) }
export class BoundaryNorm extends Normalize { constructor(boundaries: Column, ncolors?: number, clip?: boolean) }
export class ListedColormap { constructor(colors: Color[], name?: string); colors: string[]; N: number; reversed(): ListedColormap }
export const LinearSegmentedColormap: { from_list(name: string, colors: Color[]): { name: string; N: number } };
export const colors: { Normalize: typeof Normalize; LogNorm: typeof LogNorm; TwoSlopeNorm: typeof TwoSlopeNorm; CenteredNorm: typeof CenteredNorm; BoundaryNorm: typeof BoundaryNorm; ListedColormap: typeof ListedColormap; LinearSegmentedColormap: typeof LinearSegmentedColormap };

export class LinearScale { constructor(domain: [number, number], range: [number, number]); domain: [number, number]; range: [number, number]; transform(v: number): number; inverse(px: number): number; ticks(n?: number): number[] }
export class LogScale { constructor(domain: [number, number], range: [number, number]); domain: [number, number]; range: [number, number]; transform(v: number): number; inverse(px: number): number; ticks(): number[] }

export class Polygon { constructor(xy: [number, number][], opts?: PatchOpts); axes: Axes | null; get_xy(): [number, number][] }
export class Rectangle extends Polygon { constructor(xy: [number, number], width: number, height: number, opts?: PatchOpts & { angle?: number }) }
export class Circle extends Polygon { constructor(xy: [number, number], radius?: number, opts?: PatchOpts) }
/** matplotlib.cm.ScalarMappable: a colour scale with nothing behind it, for colorbar() */
export class ScalarMappable { constructor(opts?: { cmap?: Cmap; norm?: Normalize | 'linear' | 'log'; vmin?: number; vmax?: number }); set_clim(vmin: number, vmax?: number): this; set_cmap(c: Cmap): this; set_norm(n: Normalize): this; set_array(a: unknown): this }

/** SVG from a draw list (also '@gcu/plot/svg') */
export function toSVG(list: DrawList, opts?: { facecolor?: Color | null; idPrefix?: string }): string;
/** PNG bytes from RGBA, in plain JS */
export function encodePNG(rgba: ArrayLike<number>, width: number, height: number): Uint8Array;

export interface Brush { axes: Axes; x: [number, number] | null; y: [number, number] | null }
export interface ViewChange { axes: Axes; xlim: [number, number]; ylim: [number, number] }
export interface Interaction {
  element: HTMLElement; canvas: HTMLCanvasElement; overlay: HTMLCanvasElement; figure: Figure;
  readonly selection: Brush | null;
  on(ev: 'brush', fn: (b: Brush | null) => void): this;
  on(ev: 'click', fn: (p: PickHit | { axes: Axes; pick: null; x: number; y: number }) => void): this;
  on(ev: 'view', fn: (v: ViewChange) => void): this;
  on(ev: 'hover', fn: (p: PickHit | null) => void): this;
  off(ev: string, fn: Function): this;
  reset(): void; redraw(): void; setSelection(b: Brush | null): void; destroy(): void;
}
export interface InteractOpts {
  readout?: boolean; crosshair?: boolean; coordinates?: boolean; units?: string | { x?: string; y?: string }; radius?: number; label?: string;
  format?: (pick: PickHit) => string | string[] | null; extra?: (trace: object, index: number, pick: PickHit) => string | string[] | null;
  brush?: 'x' | 'y' | 'xy';
  onBrush?: (b: Brush | null) => void; onClick?: (p: object) => void; onViewChange?: (v: ViewChange) => void; onHover?: (p: PickHit | null) => void;
}
/** hover readout, zoom, pan, brush, keys and touch for a figure on a page (also '@gcu/plot/interact') */
export function interact(fig: Figure, canvas?: HTMLCanvasElement | null, opts?: InteractOpts): Interaction;
export function interact(fig: Figure, opts?: InteractOpts): Interaction;
/** one view for several axes, across figures; returns an unlink function */
export function link(axes: Axes[], opts?: { x?: boolean; y?: boolean }): () => void;

export function getCmap(name: Cmap): (t: number) => string;
export const cmap: typeof getCmap;
export function replay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, list: DrawList | unknown[][]): void;
export function recordingContext(width: number, height: number): CanvasRenderingContext2D & { ops: unknown[][] };
export const rcParams: Record<string, unknown> & { update(o: Record<string, unknown>): void };
export const VERSION: string;

/** pyplot: the stateful interface (also what adder's `import matplotlib.pyplot as plt` gets). */
export const pltAdder: Record<string, any>;
/** pyplot's chart calls: they draw on the current axes (opening a figure when there is none) and return what the `ax.` call returns. */
export function plot(...args: unknown[]): Result<[Line2D]>;
export function scatter(...args: unknown[]): Result;
export function imshow(...args: unknown[]): Result;
export function matshow(...args: unknown[]): Result;
export function bar(...args: unknown[]): Result<Bar[], { datavalues: ArrayLike<number> }>;
export function hist(x: Column | Column[], opts?: object): Result<[ArrayLike<number>, ArrayLike<number>, Result]>;
/** a new 1 × 1 figure, made current */
export function figure(opts?: { figsize?: [number, number]; dpi?: number; theme?: string | Partial<Theme> }): Figure;
/** subplot(211) / subplot(2, 1, 1): an axes of the current figure's grid (a new figure when the grid differs) */
export function subplot(...args: number[]): Axes;
/** shows every open figure and closes them: in a Python cell into its output (→ null); elsewhere → the canvas, a <div> of canvases, or (no DOM) the last Figure */
export function show(): HTMLCanvasElement | HTMLDivElement | Figure | null;
/** the end of a cell (IPython's inline backend): shows the open figures not yet shown, forgets them all, returns them */
export function flush_figures(): Figure[];
export function close(fig?: Figure | 'all'): void;
export function gca(): Axes;
export function gcf(): Figure;
export function fill(...args: (Column | string | PatchOpts)[]): (Patch & { _trace: object })[];
export function add_geometry(geojson: object, opts?: PatchOpts): Result;
// the rest of pyplot's stateful calls act on the current axes as ax.<name> does
export function xlabel(text: string, opts?: object): void;
export function ylabel(text: string, opts?: object): void;
export function title(text: string, opts?: object): void;
export function xlim(lo?: number, hi?: number): void;
export function ylim(lo?: number, hi?: number): void;
export function legend(opts?: object): void;
export function grid(on?: boolean | object, opts?: object): void;
export function savefig(name?: string, opts?: { format?: 'png' | 'svg' }): unknown;
export function colorbar(mappable?: Result | ScalarMappable | object, opts?: object): Result;
export const style: { use(name: string): void; available: string[] };
export const cm: Record<string, (t: number) => string> & { get_cmap: typeof getCmap; ScalarMappable: typeof ScalarMappable };
export function shown(): Figure[];
export function saved(): { name: string; format: 'png' | 'svg'; figure: Figure }[];
