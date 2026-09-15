import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_BAND_PCT_PER_WEEK,
  DEFAULT_SCHEDULE_DAYS,
  DEFAULT_TARGET_RATE_PCT_PER_WEEK,
} from '../../config/thresholds';
import * as C from '../classify';
import { addDays } from '../dates';
import { generateSeed } from '../seed';
import type { Settings, WeighIn } from '../types';

const settings: Settings = {
  targetRatePctPerWeek: DEFAULT_TARGET_RATE_PCT_PER_WEEK,
  noiseBandPctPerWeek: DEFAULT_NOISE_BAND_PCT_PER_WEEK,
  scheduleDays: DEFAULT_SCHEDULE_DAYS,
};

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

/**
 * Constrói semanas seg/qua/sex com a taxa pedida em % do peso corporal por semana
 * (negativo = perda).
 *
 * Prepende 4 semanas de aquecimento na mesma taxa da primeira semana pedida, para
 * que a tendência já esteja em regime quando o padrão sob teste começa. Sem isso os
 * testes estariam medindo o transiente da EMA, não a lógica de classificação — e as
 * semanas de aquecimento ficam sem classificação por decisão de projeto.
 */
const WARMUP_WEEKS = 4;
const PATTERN_START = '2026-03-02'; // segunda-feira
const WARMUP_START = '2026-02-02'; // 4 semanas antes, também segunda

function buildWeeks(ratesPctPerWeek: number[], startKg = 85): WeighIn[] {
  const firstRate = ratesPctPerWeek[0] ?? 0;
  const rates = [...new Array<number>(WARMUP_WEEKS).fill(firstRate), ...ratesPctPerWeek];

  const out: WeighIn[] = [];
  let monday = WARMUP_START;
  let level = startKg;
  for (const rate of rates) {
    const deltaPerWeek = (rate / 100) * level;
    // A variação da semana é distribuída linearmente pelos dias.
    out.push(w(monday, level));
    out.push(w(addDays(monday, 2), level + (deltaPerWeek * 2) / 7));
    out.push(w(addDays(monday, 4), level + (deltaPerWeek * 4) / 7));
    level += deltaPerWeek;
    monday = addDays(monday, 7);
  }
  return out;
}

/** Só as semanas do padrão sob teste, descartando as de aquecimento. */
function patternOnly(result: C.WeekClassification[]): C.WeekClassification[] {
  return result.filter((r) => r.week.weekStart >= PATTERN_START);
}

describe('classifyRate', () => {
  const target = 0.5;
  const noise = 0.15;

  it('classifica como boa a taxa a partir de 75% do alvo', () => {
    expect(C.classifyRate(-0.5, target, noise)).toBe('boa'); // no alvo
    expect(C.classifyRate(-0.375, target, noise)).toBe('boa'); // exatamente 75%
    expect(C.classifyRate(-0.9, target, noise)).toBe('boa'); // acima do alvo
  });

  it('classifica como progresso a perda real abaixo do alvo', () => {
    // O caso que motivou a quarta faixa: perda saudável de 0.30%/semana.
    expect(C.classifyRate(-0.3, target, noise)).toBe('progresso');
    expect(C.classifyRate(-0.2, target, noise)).toBe('progresso'); // exatamente 40%
    expect(C.classifyRate(-0.37, target, noise)).toBe('progresso');
  });

  it('classifica como neutra a variação dentro da faixa de ruído', () => {
    expect(C.classifyRate(0, target, noise)).toBe('neutra');
    expect(C.classifyRate(-0.15, target, noise)).toBe('neutra'); // borda inferior
    expect(C.classifyRate(0.15, target, noise)).toBe('neutra'); // borda superior
    expect(C.classifyRate(0.1, target, noise)).toBe('neutra'); // subiu, mas é ruído
  });

  it('classifica como neutra a perda acima do ruído mas irrelevante frente ao alvo', () => {
    expect(C.classifyRate(-0.18, target, noise)).toBe('neutra');
  });

  it('classifica como fora do plano só quando sobe além do ruído', () => {
    expect(C.classifyRate(0.16, target, noise)).toBe('fora-do-plano');
    expect(C.classifyRate(0.5, target, noise)).toBe('fora-do-plano');
  });

  it('nunca chama de fora do plano uma semana em que se perdeu peso', () => {
    for (const pct of [-0.01, -0.1, -0.2, -0.5, -2]) {
      expect(C.classifyRate(pct, target, noise)).not.toBe('fora-do-plano');
    }
  });

  it('aceita alvo guardado com sinal invertido', () => {
    // targetRatePctPerWeek é guardado positivo, mas não pode quebrar se vier negativo.
    expect(C.classifyRate(-0.5, -0.5, noise)).toBe('boa');
  });

  it('não quebra com alvo zero', () => {
    expect(C.classifyRate(-0.5, 0, noise)).toBe('neutra');
  });

  it('respeita uma faixa de ruído configurada mais larga', () => {
    expect(C.classifyRate(0.3, target, 0.15)).toBe('fora-do-plano');
    expect(C.classifyRate(0.3, target, 0.4)).toBe('neutra');
  });
});

describe('classifyWeeks', () => {
  it('não classifica a primeira semana, que não tem referência anterior', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5]), settings);
    expect(result[0]!.klass).toBeNull();
    expect(result[0]!.reason).toBe('sem-referencia');
  });

  it('não classifica as semanas de aquecimento da tendência', () => {
    // A EMA começa no primeiro peso e leva ~3 semanas para acumular o atraso de
    // regime; antes disso o delta subestima o ritmo (60% do valor real na 1ª
    // semana). Dizer "progresso" a quem está exatamente no alvo seria pior do
    // que não dizer nada.
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5]), settings);
    const warmup = result.filter((r) => r.reason === 'aquecimento');
    expect(warmup.length).toBeGreaterThan(0);
    for (const week of warmup) {
      expect(week.klass).toBeNull();
      expect(week.trendAgeDays!).toBeLessThan(21);
    }
  });

  it('volta a classificar assim que a tendência aquece', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5]), settings);
    const classified = C.classifiedOnly(result);
    expect(classified.length).toBeGreaterThan(0);
    for (const week of classified) expect(week.trendAgeDays!).toBeGreaterThanOrEqual(21);
  });

  it('a tendência aquecida mede a taxa real, sem o viés do transiente', () => {
    // É o desfecho de toda a guarda: numa rampa exatamente no alvo, a semana
    // classificada tem que ler perto de -0.5%/semana, não os -0.298 do início.
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5, -0.5]), settings);
    const last = C.lastClassifiedWeek(result)!;
    expect(last.pctPerWeek!).toBeLessThan(-0.45);
    expect(last.klass).toBe('boa');
  });

  it('identifica semanas boas numa perda no ritmo do alvo', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5, -0.5]), settings);
    const classified = C.classifiedOnly(patternOnly(result));
    expect(classified.length).toBeGreaterThanOrEqual(3);
    for (const week of classified) expect(week.klass).toBe('boa');
  });

  it('identifica um platô como neutro', () => {
    const result = C.classifyWeeks(buildWeeks([0, 0, 0, 0]), settings);
    for (const week of C.classifiedOnly(patternOnly(result))) expect(week.klass).toBe('neutra');
  });

  it('identifica ganho de peso como fora do plano', () => {
    const result = C.classifyWeeks(buildWeeks([0.6, 0.6, 0.6]), settings);
    for (const week of C.classifiedOnly(patternOnly(result))) expect(week.klass).toBe('fora-do-plano');
  });

  it('usa o sinal certo: perder peso dá taxa negativa', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5]), settings);
    const last = C.lastClassifiedWeek(result)!;
    expect(last.kgPerWeek).toBeLessThan(0);
    expect(last.pctPerWeek).toBeLessThan(0);
  });

  it('normaliza pelo intervalo real: uma semana perdida não dobra a taxa', () => {
    const full = buildWeeks([-0.5, -0.5, -0.5, -0.5]);
    // Remove a semana do meio inteira (já depois do aquecimento).
    const withGap = full.filter((x) => x.date < '2026-03-16' || x.date >= '2026-03-23');

    const result = C.classifyWeeks(withGap, settings);
    const afterGap = result.find((r) => r.week.weekStart === '2026-03-23')!;

    // O delta cobre 14 dias e é normalizado para 7: continua ~-0.5%/semana,
    // e não ~-1.0%/semana como daria a diferença bruta.
    expect(afterGap.gapDays).toBe(14);
    expect(afterGap.pctPerWeek!).toBeGreaterThan(-0.7);
    expect(afterGap.klass).toBe('boa');
  });

  it('recusa classificar quando o intervalo é longo demais', () => {
    const data = [
      ...buildWeeks([-0.5, -0.5]),
      w('2026-06-01', 80), w('2026-06-03', 79.9), w('2026-06-05', 79.8),
    ];
    const result = C.classifyWeeks(data, settings);
    const afterLongGap = result.find((r) => r.week.weekStart === '2026-06-01')!;
    expect(afterLongGap.klass).toBeNull();
    expect(afterLongGap.reason).toBe('intervalo-longo');
  });

  it('semanas sem pesagem alguma ficam sem classificação', () => {
    const data = [
      ...buildWeeks([-0.5, -0.5]),
      w('2026-03-23', 84), w('2026-03-25', 83.9), w('2026-03-27', 83.8),
    ];
    const result = C.classifyWeeks(data, settings);
    const empty = result.find((r) => r.week.count === 0);
    expect(empty).toBeDefined();
    expect(empty!.klass).toBeNull();
    expect(empty!.reason).toBe('sem-tendencia');
  });

  it('classifica semanas parciais normalmente, marcando-as como parciais', () => {
    // Uma semana com duas pesagens em vez de três ainda tem informação de
    // tendência: ela é classificada, e o gráfico é que a mostra esmaecida.
    const data = buildWeeks([-0.5, -0.5, -0.5]).filter((x) => x.date !== '2026-03-11');
    const result = C.classifyWeeks(data, settings);
    const partial = result.find((r) => r.week.weekStart === '2026-03-09')!;
    expect(partial.week.isComplete).toBe(false);
    expect(partial.klass).not.toBeNull();
  });

  it('devolve vazio sem pesagens', () => {
    expect(C.classifyWeeks([], settings)).toEqual([]);
  });
});

describe('sequências', () => {
  it('conta semanas boas seguidas', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5, -0.5]), settings);
    // 4 de aquecimento + 4 do padrão; as 3 primeiras ficam sem classificação
    // (sem referência e aquecimento), as demais são todas boas.
    expect(C.streakOf(result, 'boa')).toBe(5);
  });

  it('a sequência quebra quando muda a classificação', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5, 0, -0.5, -0.5]), settings);
    expect(C.streakOf(result, 'boa')).toBe(1);
  });

  it('currentStreak devolve a classificação corrente e o tamanho', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, 0, 0, 0, 0]), settings);
    expect(C.currentStreak(result)).toEqual({ klass: 'neutra', length: 3 });
  });

  it('currentStreak é nulo sem nenhuma semana classificada', () => {
    expect(C.currentStreak([])).toBeNull();
    // Série curta demais: tudo ainda em aquecimento.
    const short = [w('2026-03-02', 85), w('2026-03-04', 84.9), w('2026-03-06', 84.8)];
    expect(C.currentStreak(C.classifyWeeks(short, settings))).toBeNull();
  });
});

describe('regra do alerta negativo', () => {
  it('uma única semana fora do plano NÃO dispara alerta', () => {
    // A regra de tom mais importante do projeto: semana ruim isolada é
    // informação contextual, nunca alarme.
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, 0.6, 0.6]), settings);
    expect(C.outOfPlanStreak(result)).toBe(1);
    expect(C.shouldAlert(result)).toBe(false);
  });

  it('duas semanas seguidas fora do plano disparam o alerta', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, 0.6, 0.6, 0.6]), settings);
    expect(C.outOfPlanStreak(result)).toBe(2);
    expect(C.shouldAlert(result)).toBe(true);
  });

  it('três seguidas continuam disparando', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, 0.6, 0.6, 0.6, 0.6]), settings);
    expect(C.outOfPlanStreak(result)).toBe(3);
    expect(C.shouldAlert(result)).toBe(true);
  });

  it('a sequência conta só semanas consecutivas, e recomeça após a recuperação', () => {
    // Duas fases ruins separadas por uma recuperação não se somam. É o que faz a
    // regra significar "um padrão que está acontecendo agora" em vez de "um
    // total acumulado de semanas ruins na história".
    const result = C.classifyWeeks(
      buildWeeks([-0.5, 0.6, 0.6, 0.6, -0.5, -0.5, 0.6, 0.6, 0.6]),
      settings,
    );
    const outOfPlanTotal = C.classifiedOnly(result).filter(
      (week) => week.klass === 'fora-do-plano',
    ).length;

    expect(outOfPlanTotal).toBe(5); // cinco na história inteira
    expect(C.outOfPlanStreak(result)).toBe(2); // mas só duas seguidas agora
  });

  it('uma semana boa depois de duas ruins zera o alerta', () => {
    const result = C.classifyWeeks(buildWeeks([-0.5, 0.6, 0.6, 0.6, -0.5, -0.5]), settings);
    expect(C.outOfPlanStreak(result)).toBe(0);
    expect(C.shouldAlert(result)).toBe(false);
  });

  it('não dispara alerta com série vazia ou curta demais', () => {
    expect(C.shouldAlert([])).toBe(false);
    // Duas semanas de ganho, mas a tendência ainda em aquecimento: sem veredito
    // não há alerta. Uma instalação nova não pode começar com uma bronca.
    const short = [
      w('2026-03-02', 85), w('2026-03-04', 85.2), w('2026-03-06', 85.4),
      w('2026-03-09', 85.6), w('2026-03-11', 85.8), w('2026-03-13', 86.0),
    ];
    expect(C.shouldAlert(C.classifyWeeks(short, settings))).toBe(false);
  });

  it('o alerta exige 3 semanas de ganho real, porque a tendência atrasa ~1 semana', () => {
    // Documenta uma consequência medida da métrica escolhida. A tendência é
    // suavizada de propósito, então a classificação reflete o ritmo com cerca de
    // uma semana de atraso: 2 semanas de ganho sustentado produzem 1 semana
    // classificada fora do plano, e só a 3ª completa as duas seguidas.
    //
    // O atraso empurra para o lado seguro do tom: o app demora mais a reclamar,
    // nunca menos. A reclamação precoce é que seria o erro grave.
    const twoWeeks = C.classifyWeeks(buildWeeks([-0.5, 0.6, 0.6]), settings);
    expect(C.outOfPlanStreak(twoWeeks)).toBe(1);
    expect(C.shouldAlert(twoWeeks)).toBe(false);

    const threeWeeks = C.classifyWeeks(buildWeeks([-0.5, 0.6, 0.6, 0.6]), settings);
    expect(C.outOfPlanStreak(threeWeeks)).toBe(2);
    expect(C.shouldAlert(threeWeeks)).toBe(true);
  });

  it('nunca rotula como perda uma semana cuja média subiu além do ruído', () => {
    // Guarda de coerência: o delta da tendência atrasa, então pode dizer "perda"
    // numa semana em que a balança visivelmente subiu. Contradizer o que o
    // usuário vê custa mais confiança do que um alerta atrasado.
    const result = C.classifyWeeks(buildWeeks([-0.5, -0.5, -0.5, -0.5]), settings);
    for (const week of C.classifiedOnly(result)) {
      const isLoss = week.klass === 'boa' || week.klass === 'progresso';
      if (isLoss) {
        expect(week.averageDeltaPctPerWeek ?? 0).toBeLessThanOrEqual(
          settings.noiseBandPctPerWeek,
        );
      }
    }
  });

  it('a guarda de coerência rebaixa para neutra, nunca para fora do plano', () => {
    // Propriedade que torna a guarda incapaz de gerar alarme falso: ela é de mão
    // única. Verificada sobre 40 históricos sintéticos com ruído realista.
    for (let seed = 1; seed <= 40; seed++) {
      const result = C.classifyWeeks(generateSeed({ seed }), settings);
      for (const week of result) {
        if (week.demotedByAverage) expect(week.klass).toBe('neutra');
      }
    }
  });

  it('um pico isolado de sódio na sexta não caracteriza semana fora do plano', () => {
    // Verificação de ponta a ponta do princípio "nenhuma conclusão sai de uma
    // pesagem isolada": a série perde peso no ritmo do alvo, com uma única
    // sexta 1.5 kg acima por retenção de água.
    const clean = buildWeeks([-0.5, -0.5, -0.5, -0.5]);
    const spiked = clean.map((x) => (x.date === '2026-03-20' ? w(x.date, x.weightKg + 1.5) : x));
    const result = C.classifyWeeks(spiked, settings);
    expect(C.shouldAlert(result)).toBe(false);
  });
});
