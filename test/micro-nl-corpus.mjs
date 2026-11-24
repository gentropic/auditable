// The plain-language bar's EVALUATION SET — real phrasings, English and Brazilian
// Portuguese, written by hand against the DEMO project's vocabulary (File → open the demo
// project: deposit.csv with FE / SG / LITO, the demo drillholes, the topography, the mining
// phases group, the ore shell). Read by test/micro-nl.test.mjs, which trains the bar with
// every one of these texts EXCLUDED from its corpus (dispatch's contamination guard) and
// scores intent + slot accuracy, and the refusal rate on the out-of-scope set.
//
// Rules for adding a phrase: write it the way a geologist would type it, NOT by filling in
// one of nl-core.js's frames (that measures memory, not understanding); give the expected
// command and only the arguments that matter; a phrase you are unsure the bar SHOULD take is
// not an in-scope phrase.
//
// row: [phrase, tool | null, expected]   expected: { expr } for filter/select, else a subset
// of the arguments (+ groupBy), or {} when only the verb is being asked for.

// the demo project as nl-core sees it (test/micro-nl-smoke.mjs checks this against the app)
export const DEMO_SESSION = {
  layers: [
    { name: 'deposit.csv', label: null, kind: 'blocks', numCols: ['FE', 'SG'], catCol: 'LITO', categories: ['HEMATITE', 'ITABIRITE', 'CANGA', 'WASTE'] },
    { name: 'demo_assay.csv', label: 'holes · demo_assay.csv', kind: 'dh', numCols: ['FE', 'SG'], catCol: 'LITO', categories: ['HEMATITE', 'ITABIRITE', 'CANGA', 'WASTE'] },
    { name: 'topo.asc', label: 'topography', kind: 'grid', numCols: [], catCol: null, categories: [] },
    { name: 'phase1.obj', label: 'phase 1 — starter pit', kind: 'mesh', numCols: [], catCol: null, categories: [] },
    { name: 'phase2.obj', label: 'phase 2 — cutback', kind: 'mesh', numCols: [], catCol: null, categories: [] },
    { name: 'phase3.obj', label: 'phase 3 — final pit', kind: 'mesh', numCols: [], catCol: null, categories: [] },
    { name: 'ore_shell.obj', label: 'ore shell', kind: 'mesh', numCols: [], catCol: null, categories: [] },
  ],
  groups: ['demo', 'mining phases'],
};

const F = 'micro.filterBlocks', SEL = 'micro.selectBlocks', SOL = 'micro.selectBySolid', COL = 'micro.colorBy',
  CF = 'micro.clearFilter', SEC = 'micro.sectionAt', CS = 'micro.clearSection', TH = 'micro.setSectionThickness',
  ZX = 'micro.setZExag', BG = 'micro.setBackground', GT = 'micro.openGradeTonnage', SW = 'micro.openSwath',
  ST = 'micro.openStats', CT = 'micro.openContact', FA = 'micro.openFactors', XT = 'micro.openCrosstab',
  PJ = 'micro.setProjection', EX = 'micro.exportRows', VIS = 'micro.setLayerVisibility';

export const EN = [
  // filter
  ['blocks above 55 Fe in hematite', F, { expr: 'FE > 55 and LITO == "HEMATITE"' }],
  ['show me only blocks where iron is over 60', F, { expr: 'FE > 60' }],
  ['fe >= 62', F, { expr: 'FE >= 62' }],
  ['density below 3', F, { expr: 'SG < 3' }],
  ['just the itabirite', F, { expr: 'LITO == "ITABIRITE"' }],
  ['canga only', F, { expr: 'LITO == "CANGA"' }],
  ['filter to waste', F, { expr: 'LITO == "WASTE"' }],
  ['iron greater than 58 or density above 4', F, { expr: 'FE > 58 or SG > 4' }],
  ['high grade hematite with fe over 64', F, { expr: 'FE > 64 and LITO == "HEMATITE"' }],
  ['where SG is at least 3.5', F, { expr: 'SG >= 3.5' }],
  ['fe less than 40', F, { expr: 'FE < 40' }],
  ['only show the canga blocks', F, { expr: 'LITO == "CANGA"' }],
  ['model with iron at most 45', F, { expr: 'FE <= 45' }],
  ['keep the blocks with fe between 50 and 60', F, { expr: 'FE >= 50 and FE <= 60' }],
  // select (filter → selection)
  ['select blocks with fe above 60', SEL, { expr: 'FE > 60' }],
  ['select the hematite', SEL, { expr: 'LITO == "HEMATITE"' }],
  ['select everything where density is over 4', SEL, { expr: 'SG > 4' }],
  ['make a selection of the canga', SEL, { expr: 'LITO == "CANGA"' }],
  ['select fe > 62 in itabirite', SEL, { expr: 'FE > 62 and LITO == "ITABIRITE"' }],
  ['highlight blocks with iron below 35', SEL, { expr: 'FE < 35' }],
  ['select all the waste blocks', SEL, { expr: 'LITO == "WASTE"' }],
  ['pick out the blocks with Fe at least 65', SEL, { expr: 'FE >= 65' }],
  // select by a solid
  ['select inside the ore shell', SOL, { layer: 'ore shell' }],
  ['select the blocks within the ore shell', SOL, { layer: 'ore shell' }],
  ['select everything that falls inside the shell', SOL, { layer: 'ore shell' }],
  ['select blocks in the ore body', SOL, { layer: 'ore shell' }],
  ['select what is inside the ore shell solid', SOL, { layer: 'ore shell' }],
  // colour by
  ['colour by iron', COL, { column: 'FE' }],
  ['color the blocks by density', COL, { column: 'SG' }],
  ['paint by lithology', COL, { column: 'LITO' }],
  ['colour the model with sg', COL, { column: 'SG' }],
  ['shade the blocks by Fe grade', COL, { column: 'FE' }],
  ['color by rock type', COL, { column: 'LITO' }],
  ['switch the colours to density', COL, { column: 'SG' }],
  // clear filter
  ['clear the filter', CF, {}],
  ['remove all filters please', CF, {}],
  ['get rid of the filter', CF, {}],
  ['reset the block filter', CF, {}],
  ['unfilter the model', CF, {}],
  // section at
  ['section at elevation 1020', SEC, { axis: 'Z', position: 1020 }],
  ['cut a plan section at 980', SEC, { axis: 'Z', position: 980 }],
  ['slice the model at rl 1050', SEC, { axis: 'Z', position: 1050 }],
  ['north-south section at easting 611200', SEC, { axis: 'X', position: 611200 }],
  ['section at northing 7765300', SEC, { axis: 'Y', position: 7765300 }],
  ['horizontal slice at 1000, 20 m thick', SEC, { axis: 'Z', position: 1000, thickness: 20 }],
  ['show me an east-west section at 7765100 north', SEC, { axis: 'Y', position: 7765100 }],
  ['section on bench 1040', SEC, { axis: 'Z', position: 1040 }],
  // clear section
  ['clear the section', CS, {}],
  ['turn off the section', CS, {}],
  ['remove the slice', CS, {}],
  ['no more section please', CS, {}],
  ['show the whole model, no section', CS, {}],
  // thickness
  ['make the section 20 m thick', TH, { thickness: 20 }],
  ['slab thickness 50', TH, { thickness: 50 }],
  ['set the section thickness to 10 meters', TH, { thickness: 10 }],
  ['a thicker section, 40 m thick', TH, { thickness: 40 }],
  // vertical exaggeration
  ['exaggerate the vertical by 2', ZX, { factor: 2 }],
  ['z exaggeration 3', ZX, { factor: 3 }],
  ['vertical exaggeration of five', ZX, { factor: 5 }],
  ['set the vertical exaggeration back to 1', ZX, { factor: 1 }],
  ['stretch z by 1.5', ZX, { factor: 1.5 }],
  // background
  ['white background', BG, { color: 'white' }],
  ['make the background black', BG, { color: 'black' }],
  ['switch to the paper background', BG, { color: 'paper' }],
  ['dark background please', BG, { color: 'basalt' }],
  ['background back to basalt', BG, { color: 'basalt' }],
  // grade–tonnage
  ['grade tonnage for fe', GT, { column: 'FE' }],
  ['open the grade-tonnage curve', GT, {}],
  ['tonnage above cutoff for iron', GT, { column: 'FE' }],
  ['GT curve of Fe', GT, { column: 'FE' }],
  ['grade tonnage curve on iron please', GT, { column: 'FE' }],
  // swath
  ['swath of fe along x', SW, { column: 'FE', axis: 'X' }],
  ['swath plot of iron in the easting direction', SW, { column: 'FE', axis: 'X' }],
  ['drift of density along elevation', SW, { column: 'SG', axis: 'Z' }],
  ['swath along northing', SW, { axis: 'Y' }],
  ['swath plot for Fe', SW, { column: 'FE' }],
  ['swath fe by z', SW, { column: 'FE', axis: 'Z' }],
  // stats
  ['stats for fe', ST, { column: 'FE' }],
  ['summary statistics of iron by lithology', ST, { column: 'FE', groupBy: 'LITO' }],
  ['describe density', ST, { column: 'SG' }],
  ['mean and standard deviation of Fe', ST, { column: 'FE' }],
  ['open the stats window', ST, {}],
  ['quantiles of sg', ST, { column: 'SG' }],
  // contact
  ['contact plot of fe', CT, { column: 'FE' }],
  ['contact analysis for iron', CT, { column: 'FE' }],
  ['is the fe contact hard or soft', CT, { column: 'FE' }],
  ['open the contact plot', CT, {}],
  ['how does density change across the contact', CT, { column: 'SG' }],
  // factors
  ['reconciliation factors', FA, {}],
  ['open the f1 f2 f3 factors', FA, {}],
  ['mine call factors please', FA, {}],
  ['reconcile the model against grade control', FA, {}],
  // cross-tab
  ['resource table for fe', XT, { column: 'FE' }],
  ['cross-tab of iron by lithology', XT, { column: 'FE', groupBy: 'LITO' }],
  ['tonnage and grade table', XT, {}],
  ['resource crosstab', XT, {}],
  // projection
  ['maximum intensity projection', PJ, { mode: 'max' }],
  ['show the min projection', PJ, { mode: 'min' }],
  ['mean projection', PJ, { mode: 'mean' }],
  ['turn the projection off', PJ, { mode: 'off' }],
  ['MIP projection please', PJ, { mode: 'max' }],
  // export
  ['export the rows', EX, {}],
  ['export these blocks to csv', EX, {}],
  ['save the filtered rows to a file', EX, {}],
  ['export the table to parquet', EX, {}],
  ['export the data', EX, {}],
  // layer visibility
  ['hide the topography', VIS, { layer: 'topography', action: 'hide' }],
  ['show the ore shell', VIS, { layer: 'ore shell', action: 'show' }],
  ['turn off the mining phases', VIS, { layer: 'mining phases', action: 'hide' }],
  ['hide the drillholes', VIS, { layer: 'holes · demo_assay.csv', action: 'hide' }],
  ['bring back the topography', VIS, { layer: 'topography', action: 'show' }],
];

export const PT = [
  // filtro
  ['blocos com fe acima de 55 na hematita', F, { expr: 'FE > 55 and LITO == "HEMATITE"' }],
  ['só itabirito', F, { expr: 'LITO == "ITABIRITE"' }],
  ['ferro maior que 60', F, { expr: 'FE > 60' }],
  ['densidade abaixo de 3', F, { expr: 'SG < 3' }],
  ['filtra os blocos com teor de ferro acima de 62', F, { expr: 'FE > 62' }],
  ['mostra só a canga', F, { expr: 'LITO == "CANGA"' }],
  ['fe pelo menos 58', F, { expr: 'FE >= 58' }],
  ['blocos de estéril', F, { expr: 'LITO == "WASTE"' }],
  ['ferro menor que 40 ou densidade maior que 4', F, { expr: 'FE < 40 or SG > 4' }],
  ['apenas hematita com ferro acima de 64', F, { expr: 'FE > 64 and LITO == "HEMATITE"' }],
  ['teor de ferro no máximo 45', F, { expr: 'FE <= 45' }],
  // seleção
  ['seleciona os blocos com fe acima de 60', SEL, { expr: 'FE > 60' }],
  ['selecionar a hematita', SEL, { expr: 'LITO == "HEMATITE"' }],
  ['seleciona tudo com densidade maior que 4', SEL, { expr: 'SG > 4' }],
  ['selecione o itabirito com ferro acima de 55', SEL, { expr: 'FE > 55 and LITO == "ITABIRITE"' }],
  ['marca os blocos de canga', SEL, { expr: 'LITO == "CANGA"' }],
  ['seleciona ferro menor que 35', SEL, { expr: 'FE < 35' }],
  // seleção por sólido
  ['seleciona dentro do envelope de minério', SOL, { layer: 'ore shell' }],
  ['selecionar os blocos dentro do envelope', SOL, { layer: 'ore shell' }],
  ['seleciona o que está dentro da casca de minério', SOL, { layer: 'ore shell' }],
  ['selecione os blocos no envelope de minério', SOL, { layer: 'ore shell' }],
  // colorir
  ['colorir por ferro', COL, { column: 'FE' }],
  ['pinta o modelo pela densidade', COL, { column: 'SG' }],
  ['cor por litologia', COL, { column: 'LITO' }],
  ['colore os blocos por fe', COL, { column: 'FE' }],
  ['muda a cor para sg', COL, { column: 'SG' }],
  ['colorir pela litologia', COL, { column: 'LITO' }],
  // limpar filtro
  ['limpa o filtro', CF, {}],
  ['tira os filtros', CF, {}],
  ['remove o filtro por favor', CF, {}],
  ['zera o filtro', CF, {}],
  // seção
  ['seção na cota 1020', SEC, { axis: 'Z', position: 1020 }],
  ['corte horizontal na cota 980', SEC, { axis: 'Z', position: 980 }],
  ['seção norte-sul em 611200', SEC, { axis: 'X', position: 611200 }],
  ['seção leste-oeste em 7765300', SEC, { axis: 'Y', position: 7765300 }],
  ['fatia na cota 1000 com 20 m de espessura', SEC, { axis: 'Z', position: 1000, thickness: 20 }],
  ['planta no nível 1040', SEC, { axis: 'Z', position: 1040 }],
  // limpar seção
  ['tira a seção', CS, {}],
  ['desliga o corte', CS, {}],
  ['remove a seção', CS, {}],
  ['sem seção por favor', CS, {}],
  // espessura
  ['espessura da seção 20 m', TH, { thickness: 20 }],
  ['deixa a seção com 50 metros de espessura', TH, { thickness: 50 }],
  ['espessura de 10 metros na seção', TH, { thickness: 10 }],
  // exagero vertical
  ['exagero vertical 2', ZX, { factor: 2 }],
  ['exagera o z em 3 vezes', ZX, { factor: 3 }],
  ['escala vertical 1.5', ZX, { factor: 1.5 }],
  ['exagero vertical de cinco', ZX, { factor: 5 }],
  // fundo
  ['fundo branco', BG, { color: 'white' }],
  ['muda o fundo para preto', BG, { color: 'black' }],
  ['fundo papel', BG, { color: 'paper' }],
  ['deixa o fundo escuro', BG, { color: 'basalt' }],
  // teor–tonelagem
  ['curva teor tonelagem do ferro', GT, { column: 'FE' }],
  ['teor tonelagem de fe', GT, { column: 'FE' }],
  ['abre a curva de parametrização', GT, {}],
  ['tonelagem acima do teor de corte de fe', GT, { column: 'FE' }],
  // swath
  ['swath de fe ao longo de x', SW, { column: 'FE', axis: 'X' }],
  ['gráfico swath do ferro na direção norte', SW, { column: 'FE', axis: 'Y' }],
  ['análise de deriva da densidade na cota', SW, { column: 'SG', axis: 'Z' }],
  ['swath de ferro', SW, { column: 'FE' }],
  // estatísticas
  ['estatísticas de fe', ST, { column: 'FE' }],
  ['resumo estatístico do ferro por litologia', ST, { column: 'FE', groupBy: 'LITO' }],
  ['média e desvio da densidade', ST, { column: 'SG' }],
  ['abre as estatísticas', ST, {}],
  // contato
  ['gráfico de contato de fe', CT, { column: 'FE' }],
  ['análise de contato do ferro', CT, { column: 'FE' }],
  ['o contato é duro ou suave para fe', CT, { column: 'FE' }],
  ['abre o gráfico de contato', CT, {}],
  // fatores
  ['fatores de reconciliação', FA, {}],
  ['abre os fatores f1 f2 f3', FA, {}],
  ['reconciliação com o controle de teores', FA, {}],
  // tabela cruzada
  ['tabela de recursos de fe', XT, { column: 'FE' }],
  ['tabela cruzada do ferro por litologia', XT, { column: 'FE', groupBy: 'LITO' }],
  ['tabela de recursos', XT, {}],
  // projeção
  ['projeção máxima', PJ, { mode: 'max' }],
  ['projeção mínima', PJ, { mode: 'min' }],
  ['projeção pela média', PJ, { mode: 'mean' }],
  ['desliga a projeção', PJ, { mode: 'off' }],
  // exportar
  ['exportar as linhas', EX, {}],
  ['exporta os blocos para csv', EX, {}],
  ['salvar os dados filtrados num arquivo', EX, {}],
  ['exportar para parquet', EX, {}],
  // visibilidade
  ['esconde a topografia', VIS, { layer: 'topography', action: 'hide' }],
  ['mostra o envelope de minério', VIS, { layer: 'ore shell', action: 'show' }],
  ['desliga as fases de lavra', VIS, { layer: 'mining phases', action: 'hide' }],
  ['esconde os furos', VIS, { layer: 'holes · demo_assay.csv', action: 'hide' }],
  ['liga a topografia de novo', VIS, { layer: 'topography', action: 'show' }],
];

// OUT OF SCOPE: the bar must answer these with NO proposal. A wrong guess is worse than a
// refusal, so this set leans on near-misses (domain words, destructive verbs).
export const OUT_EN = [
  'delete the block model', 'save the project now', 'krige fe into the model', 'run a variogram on iron',
  'what is the weather today', 'email the report to my manager', 'undo', 'rename this layer to final',
  'how do I estimate resources', 'open a new project', 'print this view', 'close micro',
  'erase the topography', 'build a wireframe from these holes', 'calculate the stripping ratio',
  'translate this to spanish', 'who made this program', 'play some music', 'upload the model to the cloud',
  'compute a variogram map', 'merge the two models', 'tell me a joke', 'what time is it',
  'is this deposit economic', 'overwrite the original file', 'install a plugin', 'log me in',
  'convert the model to sub-blocks', 'wipe everything and start over', 'delete the drillholes from disk',
];
export const OUT_PT = [
  'apaga o modelo de blocos inteiro', 'salva o projeto agora', 'faz a krigagem do ferro', 'roda um variograma de ferro',
  'como está o tempo hoje', 'manda o relatório pro gerente', 'desfaz', 'renomeia essa camada',
  'como eu estimo recursos', 'abre um projeto novo', 'imprime essa vista', 'fecha o programa',
  'exclui a topografia', 'monta um sólido com esses furos', 'calcula a relação estéril minério',
  'traduz isso para espanhol', 'quem fez esse programa', 'toca uma música', 'sobe o modelo pra nuvem',
  'conta uma piada', 'que horas são', 'esse depósito é econômico', 'sobrescreve o arquivo original',
  'instala um plugin', 'converte o modelo em sub-blocos', 'apaga os furos do disco',
];

// FRESH: written AFTER the bar was tuned against the sets above, and scored as written — the
// less flattering, more honest estimate (the sets above were looked at while tuning). Keep it
// that way: a phrase here that fails is a finding, not something to fix in the frames by copying it.
export const FRESH = [
  ['iron above 63 please', F, { expr: 'FE > 63' }],
  ['show the hematite blocks only', F, { expr: 'LITO == "HEMATITE"' }],
  ['sg greater than 3.2 and fe above 50', F, { expr: 'SG > 3.2 and FE > 50' }],
  ['filter itabirite with iron under 45', F, { expr: 'FE < 45 and LITO == "ITABIRITE"' }],
  ['quero só os blocos de hematita', F, { expr: 'LITO == "HEMATITE"' }],
  ['filtrar ferro acima de 66', F, { expr: 'FE > 66' }],
  ['densidade maior que 3.8', F, { expr: 'SG > 3.8' }],
  ['select the itabirite blocks', SEL, { expr: 'LITO == "ITABIRITE"' }],
  ['select iron over 64', SEL, { expr: 'FE > 64' }],
  ['selecionar blocos com ferro abaixo de 30', SEL, { expr: 'FE < 30' }],
  ['select everything inside the ore shell please', SOL, { layer: 'ore shell' }],
  ['selecionar tudo dentro do envelope', SOL, { layer: 'ore shell' }],
  ['colour the blocks by lithology', COL, { column: 'LITO' }],
  ['colorir o modelo pela densidade', COL, { column: 'SG' }],
  ['remove the block filter', CF, {}],
  ['tira o filtro dos blocos', CF, {}],
  ['plan section at 1010', SEC, { axis: 'Z', position: 1010 }],
  ['seção na cota 990', SEC, { axis: 'Z', position: 990 }],
  ['get rid of the section', CS, {}],
  ['fecha o corte', CS, {}],
  ['section 30 m thick', TH, { thickness: 30 }],
  ['espessura da seção 25 metros', TH, { thickness: 25 }],
  ['vertical exaggeration 2', ZX, { factor: 2 }],
  ['exagero vertical 4', ZX, { factor: 4 }],
  ['black background please', BG, { color: 'black' }],
  ['fundo preto', BG, { color: 'black' }],
  ['grade tonnage curve for density', GT, { column: 'SG' }],
  ['curva de teor tonelagem', GT, {}],
  ['swath of density along y', SW, { column: 'SG', axis: 'Y' }],
  ['swath do ferro em z', SW, { column: 'FE', axis: 'Z' }],
  ['statistics for density', ST, { column: 'SG' }],
  ['estatísticas da densidade', ST, { column: 'SG' }],
  ['contact plot for density', CT, { column: 'SG' }],
  ['gráfico de contato da densidade', CT, { column: 'SG' }],
  ['open the reconciliation factors window', FA, {}],
  ['fatores f1 f2 f3', FA, {}],
  ['resource table by lithology', XT, { groupBy: 'LITO' }],
  ['tabela de recursos por litologia', XT, { groupBy: 'LITO' }],
  ['minimum projection', PJ, { mode: 'min' }],
  ['projeção média', PJ, { mode: 'mean' }],
  ['export the blocks to a csv file', EX, {}],
  ['exportar os dados para csv', EX, {}],
  ['hide the ore shell', VIS, { layer: 'ore shell', action: 'hide' }],
  ['mostra a topografia', VIS, { layer: 'topography', action: 'show' }],
];
export const FRESH_OUT = [
  'delete the drillholes', 'what is the cutoff grade', 'how much is the deposit worth', 'send this to the team',
  'calculate the ore reserves', 'make a pit shell', 'design the pit', 'what is the strip ratio here',
  'change my password', 'go back', 'buy more licenses', 'open google maps', 'recompute the block model',
  'apaga o envelope de minério', 'qual o teor de corte', 'quanto vale esse depósito', 'manda isso para a equipe',
  'calcula as reservas', 'faz uma cava ótima', 'projeta a cava', 'muda minha senha', 'volta', 'compra licenças',
  'abre o google maps', 'refaz o modelo de blocos', 'qual é a densidade média do estéril',
];
