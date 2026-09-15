import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_BAND_PCT_PER_WEEK,
  DEFAULT_SCHEDULE_DAYS,
  DEFAULT_TARGET_RATE_PCT_PER_WEEK,
} from '../../config/thresholds';
import { addDays, dayOfWeek } from '../dates';
import * as F from '../feedback';
import { generateSeed } from '../seed';
import type { Settings, WeighIn } from '../types';

const settings: Settings = {
  targetRatePctPerWeek: DEFAULT_TARGET_RATE_PCT_PER_WEEK,
  noiseBandPctPerWeek: DEFAULT_NOISE_BAND_PCT_PER_WEEK,
  scheduleDays: DEFAULT_SCHEDULE_DAYS,
  goalWeightKg: 80,
};

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

/** Série seg/qua/sex de `weeks` semanas, com efeito de fim de semana na segunda. */
function build(weeks: number, kgPerWeek: number, mondayExtra = 0.5): WeighIn[] {
  const out: WeighIn[] = [];
  let date = '2026-03-02'; // segunda
  const gaps = [2, 2, 3];
  let level = 90;
  for (let i = 0; i < weeks * 3; i++) {
    const dow = dayOfWeek(date);
    out.push(w(date, level + (dow === 1 ? mondayExtra : 0)));
    level += (kgPerWeek * gaps[i % 3]!) / 7;
    date = addDays(date, gaps[i % 3]!);
  }
  return out;
}

describe('isWeekClosingDay', () => {
  it('a sexta fecha a semana no ritual padrão', () => {
    expect(F.isWeekClosingDay('2026-03-06', DEFAULT_SCHEDULE_DAYS)).toBe(true);
    expect(F.isWeekClosingDay('2026-03-02', DEFAULT_SCHEDULE_DAYS)).toBe(false);
    expect(F.isWeekClosingDay('2026-03-04', DEFAULT_SCHEDULE_DAYS)).toBe(false);
  });

  it('respeita um ritual configurado diferente', () => {
    // Domingo fecha a semana num ritual [domingo, quarta]: ele é o ÚLTIMO dia de
    // uma semana que começa na segunda, embora seja o dia 0 em getDay().
    expect(F.isWeekClosingDay('2026-03-08', [0, 3])).toBe(true); // domingo
    expect(F.isWeekClosingDay('2026-03-04', [0, 3])).toBe(false); // quarta
    expect(F.isWeekClosingDay('2026-03-07', [2, 6])).toBe(true); // sábado
    expect(F.isWeekClosingDay('2026-03-03', [2, 6])).toBe(false); // terça
  });

  it('não fecha semana com ritual vazio', () => {
    expect(F.isWeekClosingDay('2026-03-06', [])).toBe(false);
  });
});

describe('buildWeighInFeedback', () => {
  const data = build(10, -0.42);
  const lastDate = data[data.length - 1]!.date;

  it('devolve nulo se não há pesagem na data', () => {
    expect(F.buildWeighInFeedback(data, settings, '2026-03-03')).toBeNull();
  });

  it('marca se hoje é dia programado do ritual', () => {
    const scheduled = F.buildWeighInFeedback(data, settings, '2026-03-02')!;
    expect(scheduled.isScheduledDay).toBe(true);

    const extra = [...data, w('2026-03-07', 89)]; // sábado
    const offDay = F.buildWeighInFeedback(extra, settings, '2026-03-07')!;
    expect(offDay.isScheduledDay).toBe(false);
  });

  it('compara com o mesmo dia da semana anterior, não com a pesagem anterior', () => {
    // Regra explícita do SPEC: segunda contra segunda. Comparar a segunda com a
    // sexta anterior mediria o fim de semana, não o progresso.
    const feedback = F.buildWeighInFeedback(data, settings, '2026-03-09')!;
    expect(feedback.sameDayLastWeek).not.toBeNull();
    expect(feedback.sameDayLastWeek!.previousDate).toBe('2026-03-02');
    expect(dayOfWeek(feedback.sameDayLastWeek!.previousDate)).toBe(1);
  });

  it('deixa a comparação nula quando não houve pesagem no mesmo dia da semana passada', () => {
    const feedback = F.buildWeighInFeedback(data, settings, '2026-03-02')!;
    expect(feedback.sameDayLastWeek).toBeNull();
  });

  it('traz a variação da tendência e a taxa semanal', () => {
    const feedback = F.buildWeighInFeedback(data, settings, lastDate)!;
    expect(feedback.trendKg).not.toBeNull();
    expect(feedback.trendDeltaKg).not.toBeNull();
    expect(feedback.rate).not.toBeNull();
    expect(feedback.rate!.kgPerWeek).toBeLessThan(0); // perdendo
  });

  it('traz o indicador de aderência da semana', () => {
    // Recorta até a data: em uso real não existem pesagens futuras.
    const upToWed = data.filter((x) => x.date <= '2026-03-04');
    const feedback = F.buildWeighInFeedback(upToWed, settings, '2026-03-04')!;
    expect(feedback.adherence.scheduledCount).toBe(3);
    expect(feedback.adherence.met).toBe(2); // seg e qua
    expect(feedback.adherence.marks[2]!.isFuture).toBe(true);
  });
});

describe('feedback de segunda-feira: rebote', () => {
  it('traz o rebote apenas às segundas', () => {
    const data = build(10, -0.42);
    expect(F.buildWeighInFeedback(data, settings, '2026-03-09')!.rebound).not.toBeNull();
    expect(F.buildWeighInFeedback(data, settings, '2026-03-11')!.rebound).toBeNull();
    expect(F.buildWeighInFeedback(data, settings, '2026-03-13')!.rebound).toBeNull();
  });

  it('compara o rebote com a média histórica do próprio usuário', () => {
    const data = build(10, -0.42, 0.5);
    const feedback = F.buildWeighInFeedback(data, settings, '2026-04-27')!;
    expect(feedback.rebound).not.toBeNull();
    expect(feedback.rebound!.historicalAverageKg).not.toBeNull();
    expect(feedback.rebound!.betterThanUsual).not.toBeNull();
  });

  it('um rebote menor que a média é uma boa notícia', () => {
    // Quatro fins de semana com +0.8 e o último com +0.2.
    const out: WeighIn[] = [];
    let friday = '2026-03-06';
    for (const bump of [0.8, 0.8, 0.8, 0.8, 0.2]) {
      out.push(w(friday, 85));
      out.push(w(addDays(friday, 3), 85 + bump));
      friday = addDays(friday, 7);
    }
    const feedback = F.buildWeighInFeedback(out, settings, out[out.length - 1]!.date)!;
    expect(feedback.rebound!.betterThanUsual).toBe(true);
    expect(feedback.rebound!.historicalAverageKg).toBeCloseTo(0.8, 6);
  });

  it('sem histórico de rebote, não afirma se foi melhor ou pior', () => {
    const out = [w('2026-03-06', 85), w('2026-03-09', 85.5)];
    const feedback = F.buildWeighInFeedback(out, settings, '2026-03-09')!;
    expect(feedback.rebound!.historicalAverageKg).toBeNull();
    expect(feedback.rebound!.betterThanUsual).toBeNull();
  });
});

describe('feedback de sexta-feira: fechamento da semana', () => {
  it('traz o fechamento apenas na sexta', () => {
    const data = build(12, -0.42);
    expect(F.buildWeighInFeedback(data, settings, '2026-05-01')!.weekClosing).not.toBeNull();
    expect(F.buildWeighInFeedback(data, settings, '2026-04-27')!.weekClosing).toBeNull();
  });

  it('classifica a semana e conta a sequência', () => {
    const data = build(12, -0.45);
    const closing = F.buildWeighInFeedback(data, settings, '2026-05-01')!.weekClosing!;
    expect(closing.klass).toBe('boa');
    expect(closing.streak).toBeGreaterThan(1);
  });

  it('não fecha semana durante o aquecimento da tendência', () => {
    const data = build(2, -0.45);
    expect(F.buildWeighInFeedback(data, settings, '2026-03-13')!.weekClosing).toBeNull();
  });

  it('NÃO dispara alerta após uma única semana fora do plano', () => {
    // A regra de tom mais importante do projeto.
    const data = [...build(8, -0.45), ...offPlanTail('2026-04-27', 88, 1)];
    const closing = F.buildWeighInFeedback(data, settings, '2026-05-01')!.weekClosing;
    if (closing) expect(closing.isAlert).toBe(false);
  });

  it('dispara alerta com contexto após semanas seguidas fora do plano', () => {
    const data = [...build(8, -0.45), ...offPlanTail('2026-04-27', 88, 4)];
    const lastFriday = data[data.length - 1]!.date;
    const closing = F.buildWeighInFeedback(data, settings, lastFriday)!.weekClosing!;
    expect(closing.klass).toBe('fora-do-plano');
    expect(closing.outOfPlanStreak).toBeGreaterThanOrEqual(2);
    expect(closing.isAlert).toBe(true);
    // O alerta vem acompanhado de dados que ajudam a entender, não de bronca.
    expect(closing.context).toHaveProperty('reboundAboveAverage');
    expect(closing.context).toHaveProperty('missedWeighIns');
  });

  function offPlanTail(startMonday: string, startKg: number, weeks: number): WeighIn[] {
    const out: WeighIn[] = [];
    let date = startMonday;
    const gaps = [2, 2, 3];
    let level = startKg;
    for (let i = 0; i < weeks * 3; i++) {
      out.push(w(date, level));
      level += (0.5 * gaps[i % 3]!) / 7;
      date = addDays(date, gaps[i % 3]!);
    }
    return out;
  }
});

describe('marcos no feedback', () => {
  it('não recomemora marcos já registrados', () => {
    const data = build(12, -0.45);
    const lastDate = data[data.length - 1]!.date;
    const first = F.buildWeighInFeedback(data, settings, lastDate)!;
    const ids = first.milestones.map((m) => m.id);
    const second = F.buildWeighInFeedback(data, settings, lastDate, {
      reachedMilestoneIds: ids,
    })!;
    expect(second.milestones).toEqual([]);
  });

  it('marca novo mínimo sem transformá-lo em celebração', () => {
    const data = build(12, -0.45);
    const feedback = F.buildWeighInFeedback(data, settings, data[data.length - 1]!.date)!;
    expect(typeof feedback.isNewLow).toBe('boolean');
  });
});

describe('buildDashboardState', () => {
  it('resume o estado sem exigir pesagem hoje', () => {
    const data = generateSeed();
    const state = F.buildDashboardState(data, settings, '2026-09-15');
    expect(state.trendKg).not.toBeNull();
    expect(state.adherence.scheduledCount).toBe(3);
    expect(typeof state.isAlert).toBe('boolean');
  });

  it('não considera a semana corrente ao resumir semanas fechadas', () => {
    // A semana em curso ainda não terminou: contá-la como veredito seria julgar
    // uma semana pela metade.
    const data = build(12, -0.45);
    const state = F.buildDashboardState(data, settings, '2026-05-13'); // uma quarta
    if (state.lastClosedWeek) {
      expect(state.lastClosedWeek.week.weekStart < '2026-05-11').toBe(true);
    }
  });

  it('funciona com série vazia', () => {
    const state = F.buildDashboardState([], settings, '2026-09-15');
    expect(state.trendKg).toBeNull();
    expect(state.rate).toBeNull();
    expect(state.isAlert).toBe(false);
    expect(state.completeWeekStreak).toBe(0);
  });
});
