// Hand corpus, pt-BR: the English corpus translated, plus a few pt-only constructions. Same contract as
// corpus.mjs; golden/corpus-pt.txt is the gate.
import { PORTUGUESE } from '../src/main.js';
import { runCorpus } from './corpus.mjs';

export const CORPUS_PT = [
  ['— básico —'],
  'krigar Cu', 'kriga o cobre no domínio oeste com o variograma v2 e uma busca de 200 m',
  'estima cobre no óxido usando krigagem ordinária com v1', 'corta o Ni a 2 %',
  'composita as amostras a 2 m na zona sulfetada', 'ajusta um variograma esférico para o Ni no domínio leste',
  ['— coordenação / quantificadores —'],
  'kriga Cu, Ni e Co nos domínios oeste e leste com v2', 'kriga Cu em todos os domínios exceto o óxido usando v1', 'apaga todos os variogramas',
  ['— referência —'],
  'kriga Cu no oeste com o último variograma de Cu', 'mostra a rodada anterior', 'exporta o modelo de blocos da rodada r1 como csv', 'compara os variogramas de Cu',
  ['— elipse —'],
  'kriga Ni no leste com v3 e 150 m', 'de novo mas com 300 m', 'mesmo para o Cu', 'refaz com krigagem simples no domínio oeste', 'de novo',
  ['— sequência —'],
  'ajusta um variograma esférico para o Cu no oeste, depois kriga o Cu no oeste com ele',
  ['— reparo —'],
  'krga Cu no dominio oeste com v1', 'kriga cobr no óxido com v1',
  ['— quebradores —'],
  'frobnica Cu', 'kriga Cu com uma coisa fofa', 'kriga o variograma', 'kriga Cu do domínio oeste', 'kriga Cu com o domínio oeste', 'kriga Cu oeste',
  'kriga Cu no oeste com 200', 'kriga no domínio oeste', 'corta Cu no oeste', 'kriga o teor no oeste', 'por que a estimativa de Ni ficou tão suave',
  'me mostra o modelo de blocos', 'kriga Cu com v1 e v2', 'compara v1 com v2', 'kriga Cu no oeste com o último variograma',
  'kriga Cu no oeste com v1 e 200 m e krigagem ordinária e v2', 'kriga Cu no oeste usando compósitos', 'kriga Cu e Ni no oeste e leste com v1 e 200 m',
  'exporta a rodada de Cu como gslib e depois apaga ela', 'kriga o Cu no oeste com 200 m com v1',
  ['— só pt —'],
  'kriga o cobre pro modelo de blocos bm1', 'ajusta o variograma de Ni dos compósitos do óxido', 'kriga Cu na zona oeste com uma busca de 200 metros',
];

if (/corpus-pt\.mjs$/.test(process.argv[1] ?? '')) process.stdout.write(runCorpus(CORPUS_PT, PORTUGUESE));
