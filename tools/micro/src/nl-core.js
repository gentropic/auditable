// micro — the plain-language bar's PURE half (no DOM, no app state): what it may say,
// what it must refuse, how a project becomes its vocabulary, and how a phrase becomes
// ONE resolved proposal ({ name, args, expr }). src/nl.js wires that proposal to the app
// (the palette row, Enter → run). Kept pure so the evaluation set (test/micro-nl.test.mjs)
// trains and scores the SAME declarations in Node, on the demo project's vocabulary,
// without a browser.
//
// The hard rule lives in nl.js and is restated here because it shapes these tables:
// dispatch PROPOSES, IT NEVER ACTS. A tool in NL_TOOLS is something the bar may SPELL OUT;
// every one of them is either a view change you can undo with a glance or a window/dialog
// that opens configured-not-run. Nothing destructive is declared, the refusal bank gives
// the destructive verbs paraphrase depth on purpose, and interpret() refuses a destructive
// verb outright whatever the classifier thinks.
//
// Bilingual: English and Brazilian Portuguese, in ONE dispatcher (dispatch's 'en+pt'
// locale — closed classes unioned, each training sentence written in ONE language, so the
// frames and synonyms below come in { en, pt } pairs).
import { deriveVocab, trainSession, tokenize, normText } from '../../../ext/dispatch/index.js';

const NOUNS = { en: ['blocks', 'the blocks', 'the model', 'the rows', 'the block model'], pt: ['blocos', 'os blocos', 'o modelo', 'as linhas', 'o modelo de blocos'] };

// The tools it may propose — DECLARATIONS ONLY (nl.js wires each one). A verb that is not
// in this list cannot be uttered, which is the point.
export const NL_TOOLS = [
  { name: 'micro.filterBlocks', kind: 'comparison-filter', nouns: NOUNS, target: 240 },
  { name: 'micro.selectBlocks', kind: 'comparison-filter', nouns: NOUNS, target: 180,
    frames: {
      en: ['select {noun} with {cond}', 'select {cond}', 'select the {noun} where {cond}', 'select all {noun} with {cond}', 'make a selection of {noun} with {cond}', 'pick {noun} with {cond}', 'highlight {noun} with {cond}', 'select {noun} {cond}', 'select everything with {cond}'],
      pt: ['selecione {noun} com {cond}', 'selecionar {noun} com {cond}', 'seleciona {cond}', 'seleciona os {noun} onde {cond}', 'selecionar todos os {noun} com {cond}', 'marca {noun} com {cond}', 'destaca {noun} com {cond}', 'faz uma seleção de {noun} com {cond}', 'seleciona tudo com {cond}', 'selecione {cond}'],
    },
    catFrames: {
      en: ['select the {v} {noun}', 'select {v}', 'select all the {v}', 'select {noun} in {v}', 'highlight the {v}', 'select everything in {v}'],
      pt: ['seleciona {v}', 'selecionar os {noun} de {v}', 'selecione a {v}', 'seleciona o {v}', 'marca os {noun} de {v}', 'seleciona tudo em {v}'],
    } },
  { name: 'micro.selectBySolid', kind: 'layer-pick', argName: 'layer', target: 100,
    frames: {
      en: ['select inside {layer}', 'select the blocks inside {layer}', 'select everything inside {layer}', 'select blocks within {layer}', 'select by solid {layer}', 'select what is inside {layer}', 'pick the blocks in {layer}', 'select the model inside {layer}', 'select the blocks that fall inside {layer}'],
      pt: ['seleciona dentro de {layer}', 'selecionar os blocos dentro de {layer}', 'selecione tudo dentro de {layer}', 'seleção pelo sólido {layer}', 'seleciona o que está dentro de {layer}', 'selecionar blocos no interior de {layer}', 'seleciona os blocos dentro do {layer}', 'seleciona os blocos dentro da {layer}', 'seleciona os blocos no {layer}'],
    } },
  { name: 'micro.colorBy', kind: 'column-pick', argName: 'column', pools: ['numeric', 'categorical'], target: 140,
    frames: {
      en: ['color the model by {col}', 'color by {col}', 'colour by {col}', 'paint the blocks by {col}', 'color the model with the {col} column', 'show {col} on the model', 'map {col}', 'color everything by {col}', 'put {col} on the color ramp', 'color the blocks with {col}', 'shade by {col}', 'set the colour to {col}', 'ramp on {col}', 'colour the blocks by {col}', 'paint by {col}', 'colours by {col}'],
      pt: ['colorir por {col}', 'colore o modelo por {col}', 'pinta os blocos por {col}', 'cor por {col}', 'mostra {col} no modelo', 'colorir com {col}', 'muda a cor para {col}', 'rampa de {col}', 'colorir os blocos pelo {col}', 'colore por {col}', 'pinta o modelo com {col}', 'pinta por {col}', 'cores por {col}'],
    } },
  { name: 'micro.clearFilter', kind: 'no-arg', target: 50,
    frames: {
      en: ['clear the filter', 'remove the filter', 'reset the filter', 'drop all filters', 'unfilter', 'clear filters', 'remove all the filters', 'take the filter off', 'no filter', 'filter off', 'clear the block filter', 'reset filters', 'unfilter everything', 'get rid of the filters'],
      pt: ['limpa o filtro', 'limpar filtro', 'remove o filtro', 'tira o filtro', 'sem filtro', 'desliga o filtro', 'zera os filtros', 'apaga o filtro', 'limpar os filtros', 'tirar todos os filtros', 'remove os filtros'],
    } },
  { name: 'micro.sectionAt', kind: 'axis-position', target: 170,
    axes: { Z: ['z', 'elevation', 'level', 'bench', 'rl', 'plan', 'horizontal', 'cota', 'elevacao', 'nivel', 'planta', 'banco'],
      X: ['x', 'easting', 'east', 'north-south', 'ns', 'leste', 'este', 'norte-sul'],
      Y: ['y', 'northing', 'north', 'east-west', 'ew', 'norte', 'leste-oeste'] } },
  { name: 'micro.clearSection', kind: 'no-arg', target: 50,
    frames: {
      en: ['clear the section', 'close the section', 'remove the section', 'no section', 'take out the section', 'section off', 'drop the section', 'get rid of the section', 'full model again, no section', 'stop sectioning', 'remove the slab', 'clear the slice', 'turn the section off', 'no slicing'],
      pt: ['limpa a seção', 'tira a seção', 'remove a seção', 'sem seção', 'desliga a seção', 'fecha a seção', 'tira o corte', 'remove a fatia', 'modelo inteiro sem corte', 'acaba com a seção', 'sem corte', 'desliga a fatia', 'limpa o corte'],
    } },
  // a THICKNESS always carries a thickness word (thick / slab / thickness / espessura); a
  // POSITION carries a place word (at / on / na cota). Both are numbers near "section" —
  // the words are what tell them apart, so each set must be unambiguous on its own.
  { name: 'micro.setSectionThickness', kind: 'number-arg', argName: 'thickness', values: [5, 10, 15, 20, 25, 30, 40, 50, 75, 100], target: 70,
    frames: {
      en: ['make the section {n} meters thick', 'section thickness {n}', 'set the slab to {n} m', '{n} meter thick section', 'thicken the section to {n}', 'slab thickness {n} meters', 'make the slab {n} m thick', 'section {n} m thick', 'thicker section, {n} m', 'set the section thickness to {n} m'],
      pt: ['seção com {n} metros de espessura', 'espessura da seção {n}', 'espessura {n} m', 'deixa a fatia com {n} m', 'engrossa a seção para {n}', 'seção de {n} m de espessura', 'espessura da fatia {n} metros', 'espessura de {n} m', 'muda a espessura para {n}'],
    } },
  { name: 'micro.setZExag', kind: 'number-arg', argName: 'factor', values: [1, 1.5, 2, 2.5, 3, 4, 5, 10], wordNumbers: true, target: 60,
    frames: {
      en: ['exaggerate z by {n}', 'vertical exaggeration {n}', 'z exaggeration {n}', 'set z exag to {n}', 'stretch the vertical by {n}', 'vertical exaggeration of {n}', 'make the z scale {n}', 'exaggerate the vertical by {n}', 'stretch z by {n}'],
      pt: ['exagero vertical {n}', 'exagera o z em {n}', 'exagero de z {n}', 'estica a vertical {n} vezes', 'exagero vertical de {n}', 'escala vertical {n}', 'exagera a vertical em {n} vezes'],
    } },
  { name: 'micro.setBackground', kind: 'lexicon-pick', argName: 'color', target: 60,
    values: { basalt: { en: ['basalt', 'the default background', 'dark grey', 'dark'], pt: ['escuro', 'padrão', 'cinza escuro', 'basalto'] }, black: { en: ['black'], pt: ['preto'] }, white: { en: ['white'], pt: ['branco'] }, paper: { en: ['paper', 'off-white'], pt: ['papel'] } },
    frames: {
      en: ['{val} background', 'set the background to {val}', 'make the background {val}', 'put the background {val}', 'background {val}', 'change the background to {val}', 'switch to the {val} background', 'background back to {val}'],
      pt: ['fundo {val}', 'muda o fundo para {val}', 'deixa o fundo {val}', 'coloca o fundo {val}', 'cor de fundo {val}', 'fundo da tela {val}', 'volta o fundo para {val}'],
    } },
  { name: 'micro.openGradeTonnage', kind: 'column-pick', argName: 'column', optional: true, target: 80,
    frames: {
      en: ['grade tonnage for {col}', 'open the grade tonnage for {col}', 'GT curve on {col}', 'grade-tonnage of {col}', 'tonnage curve for {col}', 'tonnage above cutoff for {col}', 'grade and tonnage on {col}', 'grade tonnage curve of {col}'],
      pt: ['curva de teor tonelagem de {col}', 'teor-tonelagem para {col}', 'abre o teor tonelagem de {col}', 'curva gt de {col}', 'tonelagem acima do teor de corte para {col}', 'curva de parametrização de {col}', 'teor tonelagem do {col}'],
    },
    emptyFrames: { en: ['grade tonnage', 'open the grade tonnage curve', 'GT curve', 'grade-tonnage curve', 'show the grade tonnage'], pt: ['curva teor tonelagem', 'abre a curva de teor tonelagem', 'curva de parametrização', 'teor tonelagem', 'mostra a curva de parametrização'] } },
  { name: 'micro.openSwath', kind: 'axis-pick', argName: 'axis', colArg: 'column', axisOptional: true, target: 100,
    axes: { X: ['x', 'easting', 'east', 'e-w', 'leste', 'este'], Y: ['y', 'northing', 'north', 'n-s', 'norte'], Z: ['z', 'elevation', 'vertical', 'depth', 'level', 'cota', 'elevacao', 'profundidade', 'nivel'] },
    sayAxes: { en: { X: ['x', 'easting', 'east', 'the easting direction'], Y: ['y', 'northing', 'north'], Z: ['z', 'elevation', 'depth', 'level'] },
      pt: { X: ['x', 'leste', 'a direção leste'], Y: ['y', 'norte', 'a direção norte'], Z: ['z', 'cota', 'elevação', 'profundidade'] } },
    frames: { en: ['swath along {ax}', 'swath plot along {ax}', 'swath in {ax}', 'drift plot along {ax}', '{ax} swath', 'swath by {ax}'], pt: ['swath ao longo de {ax}', 'gráfico swath em {ax}', 'análise de deriva em {ax}', 'swath na direção {ax}', 'swath por {ax}'] },
    colFrames: { en: ['swath of {col} along {ax}', 'swath plot of {col} in {ax}', 'drift of {col} along {ax}', '{col} swath along {ax}', 'swath plot for {col} by {ax}', 'swath {col} by {ax}'], pt: ['swath de {col} ao longo de {ax}', 'deriva de {col} em {ax}', 'gráfico swath do {col} na direção {ax}', 'swath do {col} por {ax}', 'análise de deriva do {col} na {ax}'] },
    colOnlyFrames: { en: ['swath of {col}', 'swath plot for {col}', 'drift analysis of {col}', 'swath plot {col}'], pt: ['swath de {col}', 'gráfico swath de {col}', 'análise de deriva de {col}', 'swath do {col}'] } },
  { name: 'micro.openStats', kind: 'column-pick', argName: 'column', optional: true, target: 90,
    frames: {
      en: ['stats for {col}', 'statistics of {col}', 'stats of {col} by {grp}', 'statistics for {col} per {grp}', 'summary stats of {col}', 'show me the stats of {col}', 'describe {col}', 'mean and std of {col}', 'quantiles of {col}', 'stats table for {col}', 'summary statistics for {col}', 'mean and standard deviation of {col}'],
      pt: ['estatísticas de {col}', 'estatística do {col}', 'estatísticas de {col} por {grp}', 'resumo de {col} por {grp}', 'resumo estatístico de {col}', 'média e desvio de {col}', 'estatística descritiva de {col}', 'quantis de {col}', 'média e desvio padrão do {col}'],
    },
    emptyFrames: { en: ['stats', 'open the stats', 'summary statistics', 'stats window', 'show the statistics'], pt: ['estatísticas', 'abre as estatísticas', 'resumo estatístico', 'mostra as estatísticas', 'abrir estatísticas', 'janela de estatísticas'] } },
  { name: 'micro.openContact', kind: 'column-pick', argName: 'column', optional: true, target: 70,
    frames: {
      en: ['contact plot of {col}', 'contact analysis for {col}', 'contact plot {col}', '{col} across the contact', 'boundary analysis of {col}', 'is the contact hard or soft for {col}', 'how does {col} change across the contact'],
      pt: ['gráfico de contato de {col}', 'análise de contato do {col}', 'contato de {col}', 'análise de contatos para {col}', 'o contato é duro ou suave para {col}', 'como o {col} muda no contato'],
    },
    emptyFrames: { en: ['contact plot', 'contact analysis', 'open the contact plot', 'show the contact analysis'], pt: ['gráfico de contato', 'análise de contato', 'abre a análise de contato'] } },
  { name: 'micro.openFactors', kind: 'no-arg', target: 45,
    frames: {
      en: ['reconciliation factors', 'open the reconciliation factors', 'F1 F2 F3', 'factors window', 'compute the mine factors', 'mine call factors', 'reconcile against grade control', 'reconcile the model with the plant', 'show the f1 f2 f3 factors'],
      pt: ['fatores de reconciliação', 'abre os fatores de reconciliação', 'fatores F1 F2 F3', 'reconciliação com o controle de teores', 'fatores da mina', 'fatores de reconciliação da mina', 'reconcilia o modelo com a usina'],
    } },
  { name: 'micro.openCrosstab', kind: 'column-pick', argName: 'column', optional: true, target: 80,
    frames: {
      en: ['resource table for {col}', 'cross-tab of {col}', 'resource table of {col} by {grp}', 'cross-tab {col} by {grp}', 'crosstab {col}', 'resource cross-tab on {col}', 'tonnage and grade table for {col}', 'pivot table of {col}'],
      pt: ['tabela de recursos de {col}', 'tabulação cruzada de {col}', 'tabela de recursos de {col} por {grp}', 'tabela cruzada de {col} por {grp}', 'tabela cruzada do {col}', 'tabela de tonelagem e teor de {col}', 'quadro de recursos para {col}'],
    },
    emptyFrames: { en: ['resource table', 'cross-tab', 'resource cross-tab', 'tonnage grade table', 'open the resource table'], pt: ['tabela de recursos', 'tabela cruzada', 'quadro de recursos', 'abre a tabela de recursos'] } },
  { name: 'micro.setProjection', kind: 'lexicon-pick', argName: 'mode', target: 60,
    values: { max: { en: ['max', 'maximum', 'mip', 'maximum intensity', 'highest'], pt: ['máxima', 'máximo', 'mip'] }, min: { en: ['min', 'minimum', 'minip', 'lowest'], pt: ['mínima', 'mínimo'] }, mean: { en: ['mean', 'average'], pt: ['média', 'médio'] }, off: { en: ['off', 'none', 'normal', 'front surface'], pt: ['desliga', 'sem', 'tira'] } },
    frames: {
      en: ['{val} projection', 'projection {val}', 'show the {val} projection', 'switch to {val} intensity projection', 'set the projection to {val}', '{val} intensity projection', 'turn the projection {val}'],
      pt: ['projeção {val}', 'projeção de {val}', 'mostra a projeção {val}', 'muda a projeção para {val}', 'projeção pela {val}', '{val} a projeção'],
    } },
  { name: 'micro.exportRows', kind: 'no-arg', target: 55,
    frames: {
      en: ['export the rows', 'export rows', 'export the filtered rows', 'export to csv', 'export the data', 'save the rows as csv', 'export the block model', 'export to parquet', 'write the rows out to a file', 'export the table', 'export the selection', 'export the blocks', 'save the data to a file'],
      pt: ['exportar as linhas', 'exporta os dados', 'exportar para csv', 'salvar as linhas em csv', 'exportar o modelo', 'exporta para parquet', 'exportar a tabela', 'exporta as linhas filtradas', 'gravar os dados num arquivo', 'exporta os blocos', 'salva os dados num arquivo'],
    } },
  { name: 'micro.setLayerVisibility', kind: 'layer-action', target: 120 },
];

// The refusal bank. A destructive verb has to be REFUSED, and refusal is learned from
// examples like anything else. Destructive verbs get paraphrase DEPTH on purpose: they are
// the one class where a confident misread would be unforgivable. (The stats / grade-tonnage
// / export questions that used to sit here are verbs now — they left the bank with that.)
export const NL_REFUSALS = [
  'how many blocks are there', 'save the project', 'run a variogram', 'krige the AU',
  'variogram of the gold', 'compute the variogram for copper', 'fit a variogram model', 'krige the grades',
  'add the drillholes', 'measure the distance between those points', 'print a report',
  'what does LOI mean', 'change the block size', 'reproject to UTM', 'open the last project',
  'what is a variogram', 'estimate the gold', 'composite the assays', 'what does itabirite mean',
  'delete the block model', 'delete the model', 'delete the topography', 'delete this layer',
  'erase the block model', 'erase the drillholes', 'destroy the pit design', 'wipe the project',
  'remove the model from disk', 'drop the database', 'format the drive', 'overwrite the file',
  'email this to my boss', 'upload it to the server', 'make me a cup of tea',
  'quantos blocos tem', 'salva o projeto', 'roda um variograma', 'faz a krigagem do ouro',
  'variograma do ouro', 'calcula o variograma do cobre', 'ajusta um modelo de variograma', 'krigagem dos teores',
  'adiciona os furos', 'mede a distância entre esses pontos', 'imprime um relatório',
  'o que significa PPC', 'muda o tamanho do bloco', 'reprojeta para UTM', 'abre o último projeto',
  'o que é um variograma', 'estima o ouro', 'compõe as amostras', 'o que quer dizer itabirito',
  'apaga o modelo de blocos', 'deleta o modelo', 'exclui a topografia', 'apaga essa camada',
  'apaga os furos', 'destrói a cava', 'limpa o projeto inteiro', 'remove o modelo do disco',
  'apaga o banco de dados', 'formata o disco', 'sobrescreve o arquivo',
  'manda isso por email pro meu chefe', 'sobe isso pro servidor', 'me faz um café',
];

// ── the session's vocabulary ────────────────────────────────────────────────────────────
// A project, described WITHOUT the app (nl.js builds this from S.layers; the evaluation
// set writes the demo project's by hand, and a browser smoke checks the two agree):
//   { layers: [{ name, label?, kind, numCols: [...], catCol?, categories?: [...] }],
//     groups: ['mining phases', …] }

// synonyms for common category VALUES, keyed by the value as stored ({ en, pt })
const VALUE_ALIASES = {
  HEMATITE: { pt: ['hematita'] }, ITABIRITE: { pt: ['itabirito'] }, CANGA: { pt: ['canga'] }, WASTE: { pt: ['estéril'] },
  ORE: { pt: ['minério'] }, OXIDE: { pt: ['óxido'] }, SULFIDE: { pt: ['sulfeto'] }, SULPHIDE: { en: ['sulfide'], pt: ['sulfeto'] },
  QUARTZITE: { pt: ['quartzito'] }, SCHIST: { pt: ['xisto'] }, GRANITE: { pt: ['granito'] }, LATERITE: { pt: ['laterita'] },
  SAPROLITE: { pt: ['saprolito'] }, BASALT: { pt: ['basalto'] }, DOLOMITE: { pt: ['dolomito'] }, DIKE: { pt: ['dique'] },
  DYKE: { pt: ['dique'] }, BRECCIA: { pt: ['brecha'] }, GOETHITE: { pt: ['goethita'] }, CLAY: { pt: ['argila'] },
  OVERBURDEN: { pt: ['capeamento'] },
};
// …and for category COLUMN names
const CATCOL_ALIASES = {
  LITO: { en: ['lithology', 'litho', 'rock type'], pt: ['litologia', 'tipo de rocha'] }, LITH: { en: ['lithology', 'litho', 'rock type'], pt: ['litologia'] },
  LITHO: { en: ['lithology', 'rock type'], pt: ['litologia'] }, LITHOLOGY: { en: ['litho', 'rock type'], pt: ['litologia'] },
  DOMAIN: { en: ['domain'], pt: ['domínio'] }, DOM: { en: ['domain'], pt: ['domínio'] }, ZONE: { en: ['zone'], pt: ['zona'] },
  CLASS: { en: ['class'], pt: ['classe'] }, RESCAT: { en: ['resource class'], pt: ['classe de recurso'] },
  WEATH: { en: ['weathering'], pt: ['intemperismo'] }, OX: { en: ['oxidation'], pt: ['oxidação'] },
};
// a layer LABEL in pt-BR (the demo's labels are English; a pt sentence names them in pt)
const LABEL_ALIASES = {
  topography: { en: ['the terrain'], pt: ['topografia', 'a topografia', 'o terreno'] },
  'ore shell': { en: ['the shell', 'the ore body', 'the ore shell solid'], pt: ['envelope de minério', 'o envelope', 'envelope', 'o corpo de minério', 'casca de minério', 'a casca de minério'] },
  'mining phases': { en: ['the phases', 'the pit phases'], pt: ['fases de lavra', 'as fases de lavra', 'as fases'] },
};
// what a layer of a kind is called — only when it is the ONLY layer of that kind (four
// meshes cannot all be "the mesh")
const BY_KIND = {
  blocks: { en: ['the model', 'the block model', 'the blocks'], pt: ['o modelo', 'o modelo de blocos', 'os blocos'] },
  points: { en: ['the points', 'the cloud'], pt: ['os pontos', 'a nuvem'] },
  dh: { en: ['the drillholes', 'the holes', 'the drilling'], pt: ['os furos', 'as sondagens', 'os furos de sondagem'] },
  mesh: { en: ['the mesh'], pt: ['a malha'] },
  grid: { en: ['the grid'], pt: ['o grid'] },
  table: { en: ['the table'], pt: ['a tabela'] },
};

const STOP = new Set(['to', 'from', 'at', 'in', 'by', 'on', 'of', 'and', 'or', 'is', 'as', 'it', 'de', 'da', 'do', 'em', 'a', 'e', 'o', 'no', 'na', 'para', 'por', 'com', 'ate']);
const uniq = (a) => [...new Set(a.filter(Boolean))];
const both = (lists) => ({ en: uniq(lists.flatMap((l) => (l && l.en) || [])), pt: uniq(lists.flatMap((l) => (l && l.pt) || [])) });

export function sessionVocab(desc) {
  const numCols = {}, catCols = {}, catValues = {}, layers = {};
  const kindCount = {}; for (const L of desc.layers || []) kindCount[L.kind] = (kindCount[L.kind] || 0) + 1;
  for (const L of desc.layers || []) {
    const nm = L.label || L.name;
    const lo = nm.replace(/\.[a-z0-9]+$/i, '').toLowerCase();          // "drillholes.csv" → "drillholes"
    // "phase 1 — starter pit", "holes · demo_assay.csv": nobody types the dash — the halves are names too
    const parts = lo.split(/\s+[—–·-]\s+/).filter((x) => x && x !== lo);
    const own = uniq([nm.toLowerCase(), lo, ...parts]);
    const art = (xs) => xs.map((x) => `the ${x}`);
    // ALWAYS ≥2 synonyms: layer-action's generator picks one that is NOT the filename,
    // so a lone-synonym layer would generate "hide undefined" into the corpus.
    layers[nm] = both([{ en: [...own, ...art(own.slice(1))], pt: own }, LABEL_ALIASES[lo], kindCount[L.kind] === 1 ? BY_KIND[L.kind] : null]);
    // a column named like a function word (an interval's FROM / TO) would turn every "to"
    // into a column mention — those stay out of the spoken vocabulary
    for (const c of L.numCols || []) if (!STOP.has(String(c).toLowerCase())) numCols[c] = { lo: 0, hi: 100, dec: 2 };
    if (L.catCol && (L.categories || []).length) {
      const cn = L.catCol, base = { en: [cn.toLowerCase()], pt: [cn.toLowerCase()] };
      catCols[cn] = both([base, CATCOL_ALIASES[cn.toUpperCase()]]);
      catValues[cn] = catValues[cn] || {};
      for (const v of L.categories) if (v) { const vl = String(v).toLowerCase(); catValues[cn][String(v)] = both([{ en: [vl], pt: [vl] }, VALUE_ALIASES[String(v).toUpperCase()]]); }
    }
  }
  // groups are addressable targets too ("hide mining phases")
  for (const g of desc.groups || []) {
    const gl = String(g).toLowerCase(), last = gl.split(/\s+/).pop();
    layers[g] = both([{ en: [gl, `the ${gl}`, ...(last && last !== gl ? [`the ${last}`] : [])], pt: [gl] }, LABEL_ALIASES[gl]]);
  }
  return deriveVocab({ numCols, catCols, catValues, layers, idCols: [], locale: 'en+pt' });
}

// The ranges in sessionVocab are FIXED (0..100), deliberately: a range only shapes the
// example numbers in generated utterances, and the tagger learns "a number after an
// operator is a value" — magnitudes barely matter while STABILITY matters a great deal
// (a range from the display made the weights depend on what the UI had happened to do).
// 10 epochs: the held-out scores are identical from 6 to 25 on the evaluation set, and the tab
// trains in well under a second instead of ~1.5 s
const NL_EPOCHS = 10;
export function trainNl(desc, { exclude = null, seed = 42, epochs = NL_EPOCHS } = {}) {
  const vocab = sessionVocab(desc);
  const { dispatcher, stats, corpus } = trainSession({ vocab, tools: NL_TOOLS, seed, epochs, extraRefusals: NL_REFUSALS,
    excludeTexts: exclude ? new Set([...exclude].map(normText)) : null });
  // the words the bar has SEEN (its whole training corpus, plus every word its declarations
  // and the session can say) — the out-of-vocabulary gate reads it
  const known = new Set(), gazWords = new Set();
  const add = (set) => (x) => { if (typeof x === 'string') for (const t of tokenize(x)) set.add(t); else if (x && typeof x === 'object') Object.values(x).forEach(add(set)); };
  for (const ex of corpus) add(known)(ex.q);
  for (const t of NL_TOOLS) for (const k of ['axes', 'sayAxes', 'values']) add(known)(t[k]);
  for (const c of Object.values(vocab.numCols)) c.syn.forEach(add(gazWords));
  [vocab.catCols, vocab.catValues, vocab.layers].forEach(add(gazWords));
  return { dispatcher, stats, vocab, known, gazWords };
}

// a phrase mostly made of words the bar never saw is not a command it knows — refuse it
// rather than let a perceptron pick the least-bad class. Numbers, names from the session
// and short function words don't count either way.
const OOV_MAX = 0.5;
// words that only ever mean destroying something — refused outright, whatever the classifier
// thinks ("apaga" / "remove" are NOT here: they also clear a filter or hide a layer)
const DENY = new Set(['delete', 'deleta', 'deletar', 'delete', 'erase', 'wipe', 'destroy', 'destroi', 'destruir', 'overwrite', 'sobrescreve', 'sobrescrever', 'format', 'formata', 'formatar', 'exclui', 'excluir', 'exclua', 'purge', 'trash']);
// words that name something the bar CANNOT do (estimation, the project itself) — a phrase
// that asks for one is out of scope even when it names a column ("krige fe" is not "colour by FE")
const NOT_HERE = new Set(['variogram', 'variograms', 'variography', 'variograma', 'variogramas', 'variografia', 'krige', 'kriging', 'krigagem', 'krigar', 'krigue',
  'estimate', 'estimation', 'estima', 'estimar', 'estimativa', 'simulate', 'simulation', 'simula', 'simular', 'simulacao', 'project', 'projects', 'projeto', 'projetos']);
const SELECT_WORDS = /^(select|selects|selected|selection|pick|highlight|selecion\w*|seleciona|selecione|selecao|marca|marque|marcar|destaca|destaque|destacar)$/;
const SHOW_HIDE = new Set(['hide', 'show', 'unhide', 'off', 'on', 'visible', 'invisible', 'see', 'back', 'remove', 'rid',
  'esconde', 'esconda', 'esconder', 'oculta', 'oculte', 'ocultar', 'desliga', 'desligue', 'desligar', 'tira', 'tire', 'tirar', 'some', 'sumir',
  'mostra', 'mostre', 'mostrar', 'exibe', 'exiba', 'exibir', 'liga', 'ligue', 'ligar', 'volta', 'volte', 'ver', 'visivel', 'invisivel', 'traz', 'traga']);
function oovShare(toks, known, gaz) {
  let content = 0, unknown = 0;
  for (const t of toks) {
    if (/^[0-9.]+$/.test(t) || t.length < 3 || gaz.has(t)) continue;
    content++;
    if (!known.has(t)) unknown++;
  }
  return content ? unknown / content : 0;
}

// a categorical COLUMN named in the phrase ("stats of FE by lithology") — the group-by
const catColNamed = (toks, vocab) => {
  for (const [col, syns] of Object.entries(vocab.catCols)) for (const s of syns) {
    const seq = tokenize(s);
    for (let i = 0; i + seq.length <= toks.length; i++) if (seq.every((w, k) => toks[i + k] === w)) return col;
  }
  return null;
};

// dispatch hands back CANONICAL args (clauses arrays) → @gcu/expr text
export function clausesToExpr(clauses, join = 'and') {
  return (clauses || []).map((c) => {
    const str = typeof c.value === 'string' && !/^-?\d/.test(c.value);
    const op = str && c.op === '=' ? '==' : c.op;
    return `${c.column} ${op} ${str ? JSON.stringify(c.value) : c.value}`;
  }).join(` ${join === 'or' ? 'or' : 'and'} `);
}

// ONE phrase → ONE proposal, or null ("I didn't understand" — the honest answer).
//   { name, args, expr?, groupBy?, tags, margin }
// a DECIMAL COMMA ("0,5", "2,5" — how Portuguese writes them) becomes a point before the phrase
// reaches the tagger, which read "cu > 0,5" as CU > 0 and "exagero vertical de 2,5" as a section
// (sweep 2026-11-25). n,ddd with n ≠ 0 stays a THOUSANDS separator (en "1,250"); every other
// digit,digit is a decimal.
export function normalizeDecimals(q) {
  return String(q).replace(/(\d+),(\d+)/g, (m, a, b) => (b.length === 3 && !/^0+$/.test(a) ? a + b : `${a}.${b}`));
}
// a section's THICKNESS read from the words that say it, wherever they sit in the phrase:
// "10 m thick", "a 20 m slab", "slab of 20", "thickness 15", "com 10 m de espessura",
// "espessura de 10". The tagger caught only a few word orders and dropped the rest.
const THICK_RES = [
  /(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?\s*(?:thick|wide)\b/,
  /(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?\s+(?:slab|slice)\b/,
  /\b(?:slab|slice|thickness)\s+(?:of\s+)?(\d+(?:\.\d+)?)/,
  /(\d+(?:\.\d+)?)\s*(?:m|metros?)?\s*de\s+espessura\b/,
  /\bespessura\s+(?:de\s+)?(\d+(?:\.\d+)?)/,
];
export function thicknessSaid(q) {
  const t = String(q).toLowerCase();
  for (const re of THICK_RES) { const m = t.match(re); if (m && +m[1] > 0) return +m[1]; }
  return null;
}

export function interpret(nl, q) {
  if (!nl || !nl.dispatcher || !q || q.trim().length < 3) return null;
  q = normalizeDecimals(q);
  const toks = tokenize(q);
  if (!toks.length) return null;
  let r;
  try { r = nl.dispatcher.dispatch(q, { surface: 'micro' }); } catch { return null; }
  const call = r && r.calls && r.calls[0];
  if (!call || !call.name) return null;
  if (toks.some((t) => DENY.has(t))) return null;                    // a destructive verb: never a proposal
  if (toks.some((t) => NOT_HERE.has(t))) return null;                // a capability it does not have
  if (oovShare(toks, nl.known, nl.gazWords) > OOV_MAX) return null;
  const args = { ...(call.arguments || {}) };
  // show/hide must be SAID — dispatch's layer-action defaults to "hide" when neither word is
  // there, which turned "is this deposit economic" into "Hide deposit.csv"
  if (call.name === 'micro.setLayerVisibility' && !toks.some((t) => SHOW_HIDE.has(t))) return null;
  // filter and select take the SAME arguments and differ only by the verb — so the verb
  // decides, deterministically, rather than a classifier weighing "show blocks with …"
  let name = call.name;
  if (name === 'micro.filterBlocks' || name === 'micro.selectBlocks') name = toks.some((t) => SELECT_WORDS.test(t)) ? 'micro.selectBlocks' : 'micro.filterBlocks';
  if (name === 'micro.sectionAt') { const th = thicknessSaid(q); if (th != null) args.thickness = th; }
  const out = { name, args, tags: r.tags, margin: r.margin, q };     // q: the phrase AS TAGGED (decimals normalised) — tags index its tokens
  if (name === 'micro.filterBlocks' || name === 'micro.selectBlocks') {
    if (!args.clauses || !args.clauses.length) return null;
    out.expr = clausesToExpr(args.clauses, args.join);
  }
  if (name === 'micro.openStats' || name === 'micro.openCrosstab') {
    const g = catColNamed(toks, nl.vocab);
    if (g && g !== args.column) out.groupBy = g;
  }
  return out;
}
