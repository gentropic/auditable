// @gcu/dispatch — session vocabulary + locale banks. NOTHING here is a
// fixture: the host derives the vocabulary from its live session (columns,
// categories, layers), so the dispatcher speaks THIS project's language and
// is rebuilt when the project changes. The locale bank carries the
// language-level closed classes (operators, units, show/hide verbs,
// word-numbers, refusal seeds) AND the sentence templates the built-in kinds
// render their corpus from (`tpl`). Banks: `en`, `pt` (pt-BR). A host that
// takes commands in both passes `locale: 'en+pt'` (or ['en', 'pt']): the
// closed classes are UNIONED (so either language's words are understood at
// inference), while each generated example is written in ONE sub-locale
// (so a training sentence never mixes "filter … acima de").
// Every word here is matched FOLDED (text.js fold: seção → secao), so banks
// may be written with their accents.

export const LOCALES = {
  en: {
    id: 'en',
    ops: {
      '>': ['above', 'over', 'greater than', 'more than', 'higher than', '>'],
      '>=': ['at least', 'no less than', '>='],
      '<': ['below', 'under', 'less than', 'lower than', '<'],
      '<=': ['at most', 'up to', '<='],
      '=': ['equal to', 'exactly', '=', '=='],
    },
    opWord: { above: '>', over: '>', greater: '>', more: '>', higher: '>', least: '>=', below: '<', under: '<', less: '<', lower: '<', most: '<=', up: '<=', equal: '=', exactly: '=', different: '!=', '>': '>', '<': '<', '=': '=' },
    units: ['percent', '%', 'm', 'meter', 'meters', 'metre', 'metres'],
    unitWords: ['percent', '%'],
    hideWords: ['hide', 'remove', 'off', 'rid', 'invisible', 'drop', 'take', 'switch'],
    showWords: ['show', 'back', 'unhide', 'visible', 'on', 'see', 'want'],
    negators: ['don', "don't", 'dont', 'not', 'no'],
    wordNums: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 },
    rangeWords: ['to', 'and', 'between', '-'],
    orWords: ['or'],
    politeSuffixes: [' please', ' for me'],
    politePrefixes: ['can you '],
    refusals: [
      'what is the average grade', 'how many records are there', 'undo that',
      'save everything', 'what does this column mean', 'email this to the team',
      'close the program', 'rename the project', 'delete everything',
      'make it prettier', 'help me', 'what can you do',
    ],
    tpl: {
      join: { and: 'and', or: 'or' },
      // a numeric condition: {c} column synonym, {o} operator phrase, {v} value
      num: ['{c} {o} {v}', '{c} is {o} {v}', 'the {c} {o} {v}', '{o} {v} {c}'],
      // a categorical condition: {v} value synonym, {cc} column synonym
      cat: ['{v}', 'in {v}', '{cc} is {v}', '{cc} = {v}', 'in the {v}'],
      range: ['{c} between {a} and {b}', '{c} from {a} to {b}', '{c} is between {a} and {b}', 'the {c} between {a} and {b}'],
      // the whole sentence around a condition ({noun} the host's noun, {cond})
      filter: ['filter {noun} with {cond}', 'show {noun} where {cond}', 'only {noun} with {cond}', 'keep {cond}', 'filter {cond}', '{cond}', '{noun} with {cond}', 'show {noun} {cond}', 'just {noun} {cond}'],
      // a categorical value alone
      catOnly: ['filter {noun} to {v}', 'only {v} {noun}', 'keep just the {v}', '{cc} is {v}', '{cc} = {v}', 'only {v}', 'just the {v} {noun}'],
      section: {
        Z: ['section at elevation {p}{th}', 'horizontal section at {p}{th}', 'cut the model at elevation {p}{th}', 'slice at {p} elevation{th}', 'put a section on the {p} elevation{th}', 'give me a{th} section at elevation {p}', 'plan section at {p}{th}'],
        X: ['north-south section at easting {p}{th}', 'section at easting {p}{th}', 'cut at easting {p}{th}', 'NS section on {p} east{th}'],
        Y: ['east-west section at northing {p}{th}', 'section at northing {p}{th}', 'cut at northing {p}{th}', 'EW section on {p} north{th}'],
      },
      thick: [' {t} m thick', ' {t} meter thick', ', {t} meters thick'],
      layerShow: ['show {x}', 'turn on {x}', 'bring {x} back', '{X} back on', 'make {x} visible', 'show {x} again'],
      layerHide: ['hide {x}', 'turn off {x}', 'remove {x} from the view', '{X} off', "I don't want to see {x}", 'make {x} invisible'],
      catShow: ['show {x}', 'bring back {x}', 'turn on {x}', 'make {x} visible', 'unhide {x}', 'put {x} back', 'I want to see {x} again', '{X} back on'],
      catHide: ['hide {x}', 'take out {x}', 'remove the {x} blocks', 'turn off {x}', '{X} off', 'drop the {x} from the view', 'get rid of {x}', "I don't want to see {x}", 'make {x} invisible', 'switch off {x}'],
    },
  },
  pt: {
    id: 'pt',
    ops: {
      '>': ['acima de', 'maior que', 'maior do que', 'mais de', 'mais que', 'superior a', 'acima', '>'],
      '>=': ['pelo menos', 'no mínimo', 'maior ou igual a', '>='],
      '<': ['abaixo de', 'menor que', 'menor do que', 'menos de', 'inferior a', 'abaixo', '<'],
      '<=': ['no máximo', 'até', 'menor ou igual a', '<='],
      '=': ['igual a', 'exatamente', '=', '=='],
    },
    opWord: { acima: '>', maior: '>', mais: '>', superior: '>', abaixo: '<', menor: '<', menos: '<', inferior: '<', ate: '<=', igual: '=', exatamente: '=', diferente: '!=' },
    units: ['por cento', '%', 'm', 'metro', 'metros'],
    unitWords: ['por cento', '%'],
    hideWords: ['esconde', 'esconda', 'esconder', 'oculta', 'oculte', 'ocultar', 'desliga', 'desligue', 'desligar', 'tira', 'tire', 'tirar', 'remove', 'remova', 'remover', 'some', 'sumir', 'apaga', 'apague'],
    showWords: ['mostra', 'mostre', 'mostrar', 'exibe', 'exiba', 'exibir', 'liga', 'ligue', 'ligar', 'volta', 'volte', 'reexibe', 'ver', 'visivel', 'aparecer', 'traz', 'traga'],
    negators: ['nao'],
    wordNums: { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 },
    rangeWords: ['a', 'e', 'entre', 'ate', '-'],
    orWords: ['ou'],
    politeSuffixes: [' por favor', ' pra mim'],
    politePrefixes: ['você pode '],
    refusals: [
      'qual é o teor médio', 'quantos registros tem', 'desfaz isso',
      'salva tudo', 'o que significa essa coluna', 'manda isso por email para a equipe',
      'fecha o programa', 'renomeia o projeto', 'apaga tudo',
      'deixa mais bonito', 'me ajuda', 'o que você sabe fazer',
    ],
    tpl: {
      join: { and: 'e', or: 'ou' },
      num: ['{c} {o} {v}', 'o {c} {o} {v}', 'teor de {c} {o} {v}', '{c} com valor {o} {v}', '{o} {v} de {c}'],
      cat: ['{v}', 'em {v}', 'de {v}', 'na {v}', 'no {v}', '{cc} {v}', '{cc} igual a {v}', '{cc} = {v}'],
      range: ['{c} entre {a} e {b}', '{c} de {a} a {b}', 'teor de {c} entre {a} e {b}', 'o {c} entre {a} e {b}'],
      filter: ['filtra {noun} com {cond}', 'filtrar {noun} com {cond}', 'filtre {noun} com {cond}', 'mostra {noun} com {cond}', 'mostrar {noun} onde {cond}', 'só {noun} com {cond}', 'somente {noun} com {cond}', 'apenas {noun} com {cond}', 'mantém {cond}', '{cond}', '{noun} com {cond}', 'filtro {cond}'],
      catOnly: ['filtra {noun} de {v}', 'só {v}', 'somente {v}', 'apenas {noun} de {v}', 'só os {noun} de {v}', '{cc} igual a {v}', 'mostra só {v}', 'filtrar {v}'],
      section: {
        Z: ['seção na cota {p}{th}', 'seção horizontal na cota {p}{th}', 'corte na cota {p}{th}', 'planta na cota {p}{th}', 'seção em planta na elevação {p}{th}', 'fatia na cota {p}{th}', 'corta o modelo na cota {p}{th}', 'seção no nível {p}{th}'],
        X: ['seção norte-sul em {p}{th}', 'seção na coordenada leste {p}{th}', 'corte norte-sul no leste {p}{th}', 'seção em x {p}{th}', 'seção norte-sul na este {p}{th}'],
        Y: ['seção leste-oeste em {p}{th}', 'seção na coordenada norte {p}{th}', 'corte leste-oeste no norte {p}{th}', 'seção em y {p}{th}'],
      },
      thick: [' com {t} m de espessura', ', {t} metros de espessura', ' de {t} m'],
      layerShow: ['mostra {x}', 'mostrar {x}', 'exibe {x}', 'liga {x}', 'volta {x}', 'traz {x} de volta', 'quero ver {x}', 'mostra {x} de novo', 'deixa {x} visível'],
      layerHide: ['esconde {x}', 'esconder {x}', 'oculta {x}', 'desliga {x}', 'tira {x} da tela', 'some com {x}', 'não quero ver {x}', 'oculte {x}', 'deixa {x} invisível'],
      catShow: ['mostra {x}', 'exibe {x}', 'liga {x}', 'volta {x}', 'quero ver {x} de novo'],
      catHide: ['esconde {x}', 'oculta {x}', 'desliga {x}', 'tira {x}', 'não quero ver {x}'],
    },
  },
};

// two (or more) banks as one: closed classes unioned, examples written per sub-locale
export function mergeLocales(ids) {
  const subs = ids.map((id) => { const L = LOCALES[id]; if (!L) throw new Error(`unknown locale ${id}`); return L; });
  if (subs.length === 1) return subs[0];
  const uniq = (k) => [...new Set(subs.flatMap((L) => L[k] || []))];
  const ops = {};
  for (const L of subs) for (const [op, ws] of Object.entries(L.ops)) ops[op] = [...new Set([...(ops[op] || []), ...ws])];
  return {
    id: ids.join('+'), subs, ops,
    opWord: Object.assign({}, ...subs.map((L) => L.opWord)),
    wordNums: Object.assign({}, ...subs.map((L) => L.wordNums)),
    units: uniq('units'), unitWords: uniq('unitWords'), hideWords: uniq('hideWords'), showWords: uniq('showWords'),
    negators: uniq('negators'), rangeWords: uniq('rangeWords'), orWords: uniq('orWords'),
    politeSuffixes: uniq('politeSuffixes'), politePrefixes: uniq('politePrefixes'), refusals: uniq('refusals'),
    tpl: subs[0].tpl,
  };
}

// element/assay lexicon — free synonyms hosts get for commonly named columns
export const ELEMENT_LEX = {
  FE: ['iron', 'Fe', 'the iron grade', 'ferro'],
  SIO2: ['silica', 'SiO2', 'the silica'],
  P: ['phosphorus', 'phos'],
  LOI: ['loss on ignition'],
  AL2O3: ['alumina'],
  MN: ['manganese'],
  AU: ['gold', 'Au', 'the gold grade'],
  CU: ['copper', 'Cu'],
  S: ['sulfur', 'the sulfur'],
  MGO: ['MgO', 'magnesia'],
  CAO: ['CaO', 'lime'],
  ZN: ['zinc', 'Zn'],
  NI: ['nickel', 'Ni'],
  AG: ['silver', 'Ag'],
  SG: ['density', 'specific gravity', 'the density'],
  DENS: ['density', 'the density'],
};
// …and its pt-BR half, merged when the locale carries pt
export const ELEMENT_LEX_PT = {
  FE: ['ferro'],
  SIO2: ['sílica'],
  P: ['fósforo'],
  LOI: ['PPC', 'perda ao fogo'],
  AL2O3: ['alumina'],
  MN: ['manganês'],
  AU: ['ouro'],
  CU: ['cobre'],
  S: ['enxofre'],
  ZN: ['zinco'],
  NI: ['níquel'],
  AG: ['prata'],
  SG: ['densidade', 'massa específica'],
  DENS: ['densidade'],
};

// deriveVocab — the host's session → synonym pools.
//   numCols:   ['FE', ...] or { FE: { syn?, lo?, hi?, dec? } }
//   catCols:   { LITO: ['lithology', 'litho'], ... }        (column-name synonyms)
//   catValues: { LITO: { HEMATITE: ['hematite'], ... } }    (per-column value synonyms)
//   layers:    { 'topo.tif': ['the topography', 'topo'], ... }
//   idCols:    ['BHID']                                     (free-string id columns)
//   locale:    'en' | 'pt' | 'en+pt' | ['en', 'pt']
// Any synonym list may instead be given PER LOCALE ({ en: [...], pt: [...] }): inference
// matches the union, while a generated sentence uses its own language's words
// (vocab.synL). Column synonyms from the element lexicons are split that way automatically.
const splitSyn = (x) => (Array.isArray(x) || x == null ? { all: x || [], by: null } : { all: Object.values(x).flat(), by: x });
export function deriveVocab({ numCols = [], catCols = {}, catValues = {}, layers = {}, idCols = [], locale = 'en', aliases = {} } = {}) {
  const ids = Array.isArray(locale) ? locale : String(locale).split('+');
  const L = mergeLocales(ids);
  const withPt = ids.includes('pt');
  const uniq = (a) => [...new Set(a)];
  const nc = {};
  const entries = Array.isArray(numCols) ? numCols.map((n) => [n, {}]) : Object.entries(numCols);
  for (const [name, cfg] of entries) {
    const up = name.toUpperCase(), al = aliases[name] || [];
    const synL = { en: uniq([name, ...(cfg.syn || []), ...(ELEMENT_LEX[up] || []), ...al]) };
    if (withPt) synL.pt = uniq([name, ...(cfg.syn || []), ...(ELEMENT_LEX_PT[up] || []), ...al]);
    const syn = uniq([...synL.en, ...(synL.pt || [])]);
    nc[name] = { syn, synL, lo: cfg.lo ?? 0.1, hi: cfg.hi ?? 100, dec: cfg.dec ?? 1 };
  }
  const synL = { catCols: {}, catValues: {}, layers: {} };
  const cc = {};
  for (const [name, syns] of Object.entries(catCols)) {
    const { all, by } = splitSyn(syns);
    cc[name] = uniq([name, ...all, ...(aliases[name] || [])]);
    if (by) synL.catCols[name] = by;
  }
  const cv = {};
  for (const [col, vals] of Object.entries(catValues)) {
    cv[col] = {};
    for (const [v, syns] of Object.entries(vals)) {
      const { all, by } = splitSyn(syns);
      cv[col][v] = uniq([...(all.length ? all : [v.toLowerCase()]), ...(aliases[v] || [])]);
      if (by) (synL.catValues[col] = synL.catValues[col] || {})[v] = by;
    }
  }
  const ly = {};
  for (const [file, syns] of Object.entries(layers)) {
    const { all, by } = splitSyn(syns);
    ly[file] = uniq([file, ...all, ...(aliases[file] || [])]);
    if (by) synL.layers[file] = by;
  }
  return { numCols: nc, catCols: cc, catValues: cv, layers: ly, idCols, locale: L.id, L, synL };
}
