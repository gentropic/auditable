// @gcu/dispatch grammar — the pt-BR locale bank. Same shape as en.js; `preps` maps each surface
// preposition to the canonical English set it can mean (de = of/from), and the types downstream
// resolve the polysemy. `headFirst` flips the compound order (variograma esférico).
export const PORTUGUESE = {
  code: 'pt', headFirst: true,
  DET: 'o|a|os|as|um|uma|uns|umas|este|esta|esse|essa|meu|minha|nosso|nossa',
  REF: 'último|última|ultimo|ultima|últimos|últimas|anterior|atual|primeiro|primeira|novo|nova',
  QUANT: 'todos|todas|todo|toda|cada', EXCEPT: 'exceto|menos|excluindo|tirando|fora', CONJ: 'e|ou|mais', COMMA: ',',
  PREP: 'com|usando|por|em|no|na|nos|nas|para|pra|pro|de|do|da|dos|das|a|ao|à|até|como|acima de|abaixo de|sem|contra|dentro de|sobre',
  THEN: 'depois|então|em seguida|aí', BUT: 'mas|porém|só que', PRON: 'isso|isto|ele|ela|eles|elas',
  AGAIN: 'de novo|novamente|repete|repetir|refaz|refazer|mesmo|mesma|igual|outra vez',
  QWORD: 'por que|porque|como|qual|quais|quando|quem|é|são|será|pode|poderia|deveria|dá',
  WH: 'qual|quais|que', COP: 'é|são|sao|era|foi|eram|foram', WHCOP: 'qual é|qual e|quais são|quais sao|o que é|o que e|quanto é|quanto e|quanto dá|quanto da|quanto são|quanto sao',
  FILLER: 'por favor|agora|só|me|favor|pra mim|então|ei|oi|olá|valeu|obrigado|obrigada|beleza|aí|tá|dá pra|dá para|você pode|pode|consegue|queria que você|quero que você|vamos|bora',
  preps: {   // surface → canonical set; polysemy is resolved by types downstream
    com: ['with'], usando: ['using'], por: ['by'], em: ['in', 'on'], no: ['in', 'on'], na: ['in', 'on'], nos: ['in', 'on'], nas: ['in', 'on'],
    para: ['for', 'to', 'into'], pra: ['for', 'to', 'into'], pro: ['for', 'to', 'into'], de: ['of', 'from'], do: ['of', 'from'], da: ['of', 'from'], dos: ['of', 'from'], das: ['of', 'from'],
    a: ['to', 'at'], ao: ['to', 'at'], 'à': ['to', 'at'], 'até': ['to'], como: ['as'], 'acima de': ['above', 'over'], 'abaixo de': ['below', 'under'],
    sem: ['without'], contra: ['against'], 'dentro de': ['into'], sobre: ['on'],
  },
  indefinite: ['um', 'uma', 'uns', 'umas'], newRef: ['novo', 'nova'], firstRef: ['primeiro', 'primeira'],
  phr: { new: 'novo', last: 'último', every: 'todo', except: 'exceto', fromRun: 'da rodada', above: 'acima de', below: 'abaixo de', then: 'Depois', assuming: 'assumindo', of: 'de', hole: '___', than: 'que' },
  stem: w => { let x = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (x.length > 5 && /(ando|endo|indo|amos|emos|imos|aram|eram|iram)$/.test(x)) return x.slice(0, -4);
    if (x.length > 3 && /s$/.test(x)) x = x.slice(0, -1);
    if (x.length > 4 && /(ou|eu|iu|ei|ar|er|ir|am|em)$/.test(x)) x = x.slice(0, -2); else if (x.length > 3 && /[aeo]$/.test(x)) x = x.slice(0, -1); return x; },
  gender: w => ({ variograma: 'm', semivariograma: 'm', modelo: 'm', dia: 'm', mapa: 'm' }[w] ?? (/a$/.test(w) ? 'f' : 'm')),
  agree: { m: { novo: 'novo', 'último': 'último', todo: 'todo' }, f: { novo: 'nova', 'último': 'última', todo: 'toda' } }, plural: w => /s$/.test(w),
  REL: 'que', SUBJ: 'eu|a gente|nós|você|voce|vocês', TIME: 'hoje|ontem|hoje de manhã|hoje de manha|essa semana|esta semana|semana passada|esse mês|este mês|mês passado|mes passado|antes',
  times: { hoje: [0, 1], ontem: [1, 2], 'hoje de manhã': [0, 1], 'hoje de manha': [0, 1], 'essa semana': [0, 7], 'esta semana': [0, 7], 'semana passada': [7, 14], 'esse mês': [0, 30], 'este mês': [0, 30], 'mês passado': [30, 60], 'mes passado': [30, 60], antes: [0, 3650] },
  COMP: 'maior|menor|mais larga|mais larg|mais estreita|mais longa|mais curta',
  comps: { maior: ['+', 0], menor: ['-', 0], 'mais larga': ['+', 0], 'mais larg': ['+', 0], 'mais estreita': ['-', 0], 'mais longa': ['+', 0], 'mais curta': ['-', 0] },
};
