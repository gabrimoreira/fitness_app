import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE_DAYS } from '../../config/thresholds';
import { computeTrend } from '../trend';
import type { WeighIn } from '../types';
import * as W from '../weekly';

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

const SCHEDULE = DEFAULT_SCHEDULE_DAYS; // seg, qua, sex

// Semana de referência: 2026-09-14 (seg) a 2026-09-20 (dom).
const MON = '2026-09-14';
const WED = '2026-09-16';
const FRI = '2026-09-18';

describe('scheduledDatesInWeek', () => {
  it('devolve as datas de seg, qua e sex da semana', () => {
    expect(W.scheduledDatesInWeek(MON, SCHEDULE)).toEqual([MON, WED, FRI]);
  });

  it('respeita uma configuração diferente de dias', () => {
    expect(W.scheduledDatesInWeek(MON, [2, 6])).toEqual(['2026-09-15', '2026-09-19']);
  });

  it('coloca o domingo no fim da semana, não no começo', () => {
    expect(W.scheduledDatesInWeek(MON, [0])).toEqual(['2026-09-20']);
  });

  it('devolve vazio para configuração vazia', () => {
    expect(W.scheduledDatesInWeek(MON, [])).toEqual([]);
  });
});

describe('summarizeWeeks', () => {
  it('devolve vazio sem pesagens', () => {
    expect(W.summarizeWeeks([], SCHEDULE)).toEqual([]);
  });

  it('calcula a média simples das pesagens da semana', () => {
    const weeks = W.summarizeWeeks([w(MON, 85.0), w(WED, 84.0), w(FRI, 83.0)], SCHEDULE);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.averageKg).toBeCloseTo(84.0, 10);
    expect(weeks[0]!.count).toBe(3);
  });

  it('marca como completa a semana com todos os dias programados', () => {
    const weeks = W.summarizeWeeks([w(MON, 85), w(WED, 84), w(FRI, 83)], SCHEDULE);
    expect(weeks[0]!.isComplete).toBe(true);
    expect(weeks[0]!.scheduledMet).toBe(3);
    expect(weeks[0]!.scheduledCount).toBe(3);
    expect(weeks[0]!.missedDates).toEqual([]);
  });

  it('marca como parcial a semana com dia programado faltando, e diz qual', () => {
    const weeks = W.summarizeWeeks([w(MON, 85), w(FRI, 83)], SCHEDULE);
    expect(weeks[0]!.isComplete).toBe(false);
    expect(weeks[0]!.scheduledMet).toBe(2);
    expect(weeks[0]!.missedDates).toEqual([WED]);
  });

  it('uma pesagem extra fora do ritual não deixa a semana incompleta', () => {
    // Pesar no sábado além de seg/qua/sex não é falha de aderência.
    const weeks = W.summarizeWeeks(
      [w(MON, 85), w(WED, 84), w(FRI, 83), w('2026-09-19', 83.2)],
      SCHEDULE,
    );
    expect(weeks[0]!.isComplete).toBe(true);
    expect(weeks[0]!.count).toBe(4);
    // ...mas entra na média da semana.
    expect(weeks[0]!.averageKg).toBeCloseTo((85 + 84 + 83 + 83.2) / 4, 10);
  });

  it('uma semana só de pesagens fora do ritual é parcial', () => {
    const weeks = W.summarizeWeeks([w('2026-09-19', 83.2)], SCHEDULE);
    expect(weeks[0]!.isComplete).toBe(false);
    expect(weeks[0]!.scheduledMet).toBe(0);
    expect(weeks[0]!.count).toBe(1);
  });

  it('agrupa domingo na semana que começou na segunda anterior', () => {
    const weeks = W.summarizeWeeks([w(MON, 85), w('2026-09-20', 84)], SCHEDULE);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.count).toBe(2);
  });

  it('separa semanas adjacentes corretamente', () => {
    const weeks = W.summarizeWeeks([w('2026-09-20', 85), w('2026-09-21', 84)], SCHEDULE);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.weekStart).toBe('2026-09-14');
    expect(weeks[1]!.weekStart).toBe('2026-09-21');
  });

  it('inclui semanas vazias no meio, para que a lacuna do ritual apareça', () => {
    // Omitir a semana vazia esconderia justamente o que interessa na aderência.
    const weeks = W.summarizeWeeks([w(MON, 85), w('2026-10-05', 84)], SCHEDULE);
    expect(weeks).toHaveLength(4);
    expect(weeks.map((x) => x.count)).toEqual([1, 0, 0, 1]);
    expect(weeks[1]!.averageKg).toBeNull();
    expect(weeks[1]!.isComplete).toBe(false);
    expect(weeks[1]!.missedDates).toHaveLength(3);
  });

  it('atravessa a virada de ano', () => {
    const weeks = W.summarizeWeeks([w('2026-12-28', 85), w('2027-01-04', 84)], SCHEDULE);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.weekStart).toBe('2026-12-28');
    expect(weeks[1]!.weekStart).toBe('2027-01-04');
  });

  it('anexa a tendência no fim de cada semana quando recebe a série', () => {
    const series = [w(MON, 85), w(WED, 84), w(FRI, 83)];
    const weeks = W.summarizeWeeks(series, SCHEDULE, computeTrend(series));
    expect(weeks[0]!.trendAtEndDate).toBe(FRI);
    expect(weeks[0]!.trendAtEnd).not.toBeNull();
  });

  it('deixa a tendência nula em semana sem pesagem', () => {
    const series = [w(MON, 85), w('2026-10-05', 84)];
    const weeks = W.summarizeWeeks(series, SCHEDULE, computeTrend(series));
    expect(weeks[1]!.trendAtEnd).toBeNull();
    expect(weeks[1]!.trendAtEndDate).toBeNull();
  });

  it('com configuração de dias vazia, nenhuma semana é completa', () => {
    const weeks = W.summarizeWeeks([w(MON, 85)], []);
    expect(weeks[0]!.isComplete).toBe(false);
    expect(weeks[0]!.scheduledCount).toBe(0);
  });
});

describe('weekAdherence', () => {
  it('conta os dias programados cumpridos na semana corrente', () => {
    const a = W.weekAdherence([w(MON, 85), w(WED, 84)], SCHEDULE, WED);
    expect(a.scheduledCount).toBe(3);
    expect(a.met).toBe(2);
    expect(a.marks.map((m) => m.done)).toEqual([true, true, false]);
  });

  it('distingue dia programado ainda no futuro de dia perdido', () => {
    // Na quarta, a sexta ainda não é uma falha: o marcador ○ significa coisas
    // diferentes antes e depois da data.
    const a = W.weekAdherence([w(MON, 85), w(WED, 84)], SCHEDULE, WED);
    expect(a.marks.map((m) => m.isFuture)).toEqual([false, false, true]);
  });

  it('marca dia programado passado e sem pesagem como não futuro', () => {
    const a = W.weekAdherence([w(MON, 85)], SCHEDULE, FRI);
    expect(a.marks[1]).toMatchObject({ date: WED, done: false, isFuture: false });
  });

  it('ignora pesagens de outras semanas', () => {
    const a = W.weekAdherence([w('2026-09-07', 85), w(MON, 85)], SCHEDULE, MON);
    expect(a.met).toBe(1);
  });
});

describe('completeWeekStreak', () => {
  function buildWeeks(pattern: boolean[]): WeighIn[] {
    // Constrói semanas consecutivas a partir de 2026-08-03 (uma segunda),
    // completas ou faltando a quarta conforme o padrão.
    const series: WeighIn[] = [];
    let monday = '2026-08-03';
    for (const complete of pattern) {
      const [y, m, d] = monday.split('-').map(Number) as [number, number, number];
      const base = Date.UTC(y, m - 1, d);
      const day = (offset: number) => new Date(base + offset * 86400000).toISOString().slice(0, 10);
      series.push(w(day(0), 85));
      if (complete) series.push(w(day(2), 84.8));
      series.push(w(day(4), 84.6));
      monday = day(7);
    }
    return series;
  }

  it('conta semanas completas consecutivas', () => {
    const series = buildWeeks([true, true, true]);
    const weeks = W.summarizeWeeks(series, SCHEDULE);
    // Referência numa semana posterior, para que as três já estejam encerradas.
    expect(W.completeWeekStreak(weeks, '2026-08-31')).toBe(3);
  });

  it('a sequência quebra na primeira semana parcial', () => {
    const series = buildWeeks([true, false, true, true]);
    const weeks = W.summarizeWeeks(series, SCHEDULE);
    expect(W.completeWeekStreak(weeks, '2026-09-07')).toBe(2);
  });

  it('não conta a semana corrente, que ainda está em curso', () => {
    // Na segunda-feira só houve uma das três pesagens, e isso não pode zerar
    // uma sequência conquistada nas semanas anteriores.
    const series = buildWeeks([true, true]);
    const weeks = W.summarizeWeeks([...series, w('2026-08-17', 84)], SCHEDULE);
    expect(W.completeWeekStreak(weeks, '2026-08-17')).toBe(2);
  });

  it('é zero quando a última semana encerrada foi parcial', () => {
    const series = buildWeeks([true, true, false]);
    const weeks = W.summarizeWeeks(series, SCHEDULE);
    expect(W.completeWeekStreak(weeks, '2026-08-31')).toBe(0);
  });

  it('é zero sem semanas', () => {
    expect(W.completeWeekStreak([], '2026-09-14')).toBe(0);
  });
});
