import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import * as DW from '../dayOfWeek';
import type { WeighIn } from '../types';

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

/**
 * Série seg/qua/sex a partir de uma segunda, com efeito de fim de semana embutido:
 * a segunda sai `mondayExtra` kg acima do nível base, e o nível cai `kgPerWeek`.
 */
function series(weeks: number, opts: { mondayExtra?: number; kgPerWeek?: number } = {}) {
  const { mondayExtra = 0.6, kgPerWeek = 0 } = opts;
  const out: WeighIn[] = [];
  let date = '2026-03-02'; // segunda-feira
  const gaps = [2, 2, 3];
  for (let i = 0; i < weeks * 3; i++) {
    const level = 85 - (kgPerWeek * i) / 3;
    out.push(w(date, i % 3 === 0 ? level + mondayExtra : level));
    date = addDays(date, gaps[i % 3]!);
  }
  return out;
}

describe('deviationByDayOfWeek', () => {
  it('detecta a segunda mais pesada que os outros dias', () => {
    const data = series(12, { mondayExtra: 0.6 });
    const asOf = data[data.length - 1]!.date;
    const devs = DW.deviationByDayOfWeek(data, asOf);

    const byDay = new Map(devs.map((d) => [d.dayOfWeek, d]));
    expect(byDay.get(1)!.meanDeviationKg).toBeGreaterThan(0); // segunda
    expect(byDay.get(3)!.meanDeviationKg).toBeLessThan(0); // quarta
    expect(byDay.get(5)!.meanDeviationKg).toBeLessThan(0); // sexta
  });

  it('mede a magnitude certa, sem o encolhimento da fórmula causal', () => {
    // Com 1 dia em 3 sendo segunda, o desvio verdadeiro da segunda é
    // mondayExtra * 2/3, e o dos outros dias é -mondayExtra * 1/3.
    const data = series(12, { mondayExtra: 0.6 });
    const asOf = data[data.length - 1]!.date;
    const byDay = new Map(DW.deviationByDayOfWeek(data, asOf).map((d) => [d.dayOfWeek, d]));

    expect(byDay.get(1)!.meanDeviationKg).toBeCloseTo(0.6 * (2 / 3), 2);
    expect(byDay.get(3)!.meanDeviationKg).toBeCloseTo(-0.6 / 3, 2);
    expect(byDay.get(5)!.meanDeviationKg).toBeCloseTo(-0.6 / 3, 2);
  });

  it('os desvios dos dias somam aproximadamente zero', () => {
    const data = series(12, { mondayExtra: 0.6 });
    const asOf = data[data.length - 1]!.date;
    const devs = DW.deviationByDayOfWeek(data, asOf);
    const total = devs.reduce((s, d) => s + d.meanDeviationKg * d.n, 0);
    expect(total / devs.reduce((s, d) => s + d.n, 0)).toBeCloseTo(0, 2);
  });

  it('não inventa efeito de fim de semana onde não há', () => {
    // O caso que mais importa não errar: uma tendência em queda, sem nenhum efeito
    // de dia da semana, não pode produzir um padrão semanal aparente.
    const data = series(12, { mondayExtra: 0, kgPerWeek: 0.42 });
    const asOf = data[data.length - 1]!.date;
    for (const d of DW.deviationByDayOfWeek(data, asOf)) {
      expect(Math.abs(d.meanDeviationKg)).toBeLessThan(0.05);
    }
  });

  it('separa o efeito de fim de semana da tendência em queda', () => {
    const data = series(12, { mondayExtra: 0.6, kgPerWeek: 0.42 });
    const asOf = data[data.length - 1]!.date;
    const byDay = new Map(DW.deviationByDayOfWeek(data, asOf).map((d) => [d.dayOfWeek, d]));
    expect(byDay.get(1)!.meanDeviationKg).toBeCloseTo(0.6 * (2 / 3), 1);
  });

  it('respeita a janela de semanas', () => {
    const data = series(20, { mondayExtra: 0.6 });
    const asOf = data[data.length - 1]!.date;
    const short = DW.deviationByDayOfWeek(data, asOf, 4);
    const long = DW.deviationByDayOfWeek(data, asOf, 16);
    expect(short[0]!.n).toBeLessThan(long[0]!.n);
  });

  it('devolve vazio sem dados', () => {
    expect(DW.deviationByDayOfWeek([], '2026-09-14')).toEqual([]);
  });

  it('devolve vazio quando não há pontos com linha de base utilizável', () => {
    expect(DW.deviationByDayOfWeek([w('2026-09-14', 85)], '2026-09-14')).toEqual([]);
  });

  it('rotula os dias em português', () => {
    const data = series(12);
    const devs = DW.deviationByDayOfWeek(data, data[data.length - 1]!.date);
    expect(devs.map((d) => d.label)).toEqual(['seg', 'qua', 'sex']);
  });
});

describe('weekendRebounds', () => {
  it('pareia cada sexta com a segunda seguinte', () => {
    const data = [
      w('2026-03-06', 84.0), // sexta
      w('2026-03-09', 84.5), // segunda
      w('2026-03-13', 83.8), // sexta
      w('2026-03-16', 84.1), // segunda
    ];
    const rebounds = DW.weekendRebounds(data);
    expect(rebounds).toHaveLength(2);
    expect(rebounds[0]!.deltaKg).toBeCloseTo(0.5, 10);
    expect(rebounds[1]!.deltaKg).toBeCloseTo(0.3, 10);
  });

  it('descarta a sexta sem a segunda correspondente', () => {
    const data = [w('2026-03-06', 84.0), w('2026-03-11', 84.2)]; // segunda faltou
    expect(DW.weekendRebounds(data)).toEqual([]);
  });

  it('descarta a segunda sem a sexta anterior', () => {
    const data = [w('2026-03-04', 84.0), w('2026-03-09', 84.5)]; // quarta, não sexta
    expect(DW.weekendRebounds(data)).toEqual([]);
  });

  it('ignora pares com intervalo diferente de 3 dias', () => {
    // Uma pesagem de sábado do histórico importado não pode virar par com a
    // segunda: mede uma janela de outro tamanho e contaminaria a média histórica.
    const data = [w('2026-03-07', 84.0), w('2026-03-09', 84.5)]; // sábado -> segunda
    expect(DW.weekendRebounds(data)).toEqual([]);
  });

  it('registra rebote negativo quando se perde peso no fim de semana', () => {
    const data = [w('2026-03-06', 84.0), w('2026-03-09', 83.6)];
    expect(DW.weekendRebounds(data)[0]!.deltaKg).toBeCloseTo(-0.4, 10);
  });

  it('devolve vazio sem dados', () => {
    expect(DW.weekendRebounds([])).toEqual([]);
  });
});

describe('reboundAverage e reboundMovingAverage', () => {
  function reboundSeries(deltas: number[]): WeighIn[] {
    const out: WeighIn[] = [];
    let friday = '2026-03-06';
    for (const delta of deltas) {
      out.push(w(friday, 84.0));
      out.push(w(addDays(friday, 3), 84.0 + delta));
      friday = addDays(friday, 7);
    }
    return out;
  }

  it('faz a média das últimas ocorrências', () => {
    const rebounds = DW.weekendRebounds(reboundSeries([0.4, 0.6, 0.8]));
    expect(DW.reboundAverage(rebounds)).toBeCloseTo(0.6, 10);
  });

  it('limita a média às últimas `count` ocorrências', () => {
    const rebounds = DW.weekendRebounds(reboundSeries([5, 5, 0.4, 0.6]));
    expect(DW.reboundAverage(rebounds, 2)).toBeCloseTo(0.5, 10);
  });

  it('devolve nulo sem ocorrências', () => {
    expect(DW.reboundAverage([])).toBeNull();
  });

  it('a média móvel tem um ponto por ocorrência e começa na própria ocorrência', () => {
    const rebounds = DW.weekendRebounds(reboundSeries([0.4, 0.6, 0.8]));
    const ma = DW.reboundMovingAverage(rebounds);
    expect(ma).toHaveLength(3);
    expect(ma[0]!.movingAverageKg).toBeCloseTo(0.4, 10);
    expect(ma[1]!.movingAverageKg).toBeCloseTo(0.5, 10);
    expect(ma[2]!.movingAverageKg).toBeCloseTo(0.6, 10);
  });
});

describe('latestReboundInContext', () => {
  function reboundSeries(deltas: number[]): WeighIn[] {
    const out: WeighIn[] = [];
    let friday = '2026-03-06';
    for (const delta of deltas) {
      out.push(w(friday, 84.0));
      out.push(w(addDays(friday, 3), 84.0 + delta));
      friday = addDays(friday, 7);
    }
    return out;
  }

  it('compara a ocorrência atual com a média das anteriores, sem incluí-la', () => {
    // Três rebotes de 0.6 e um de 0.4: a régua tem que ser 0.6, não 0.55.
    const data = reboundSeries([0.6, 0.6, 0.6, 0.4]);
    const asOf = data[data.length - 1]!.date;
    const ctx = DW.latestReboundInContext(data, asOf)!;

    expect(ctx.current.deltaKg).toBeCloseTo(0.4, 10);
    expect(ctx.historicalAverageKg).toBeCloseTo(0.6, 10);
    expect(ctx.n).toBe(3);
  });

  it('devolve régua nula na primeira ocorrência da história', () => {
    const data = reboundSeries([0.5]);
    const ctx = DW.latestReboundInContext(data, data[data.length - 1]!.date)!;
    expect(ctx.historicalAverageKg).toBeNull();
    expect(ctx.n).toBe(0);
  });

  it('não olha ocorrências posteriores à data de referência', () => {
    const data = reboundSeries([0.6, 0.6, 2.0]);
    const ctx = DW.latestReboundInContext(data, '2026-03-16')!;
    expect(ctx.current.mondayDate).toBe('2026-03-16');
    expect(ctx.current.deltaKg).toBeCloseTo(0.6, 10);
  });

  it('devolve nulo quando não há nenhum rebote', () => {
    expect(DW.latestReboundInContext([], '2026-03-09')).toBeNull();
  });
});

describe('sameDayLastWeek', () => {
  it('acha a pesagem exatamente 7 dias antes', () => {
    const data = [w('2026-03-02', 85.0), w('2026-03-09', 84.5)];
    expect(DW.sameDayLastWeek(data, '2026-03-09')!.weightKg).toBe(85.0);
  });

  it('devolve nulo se não houve pesagem naquele dia', () => {
    const data = [w('2026-03-03', 85.0), w('2026-03-09', 84.5)];
    expect(DW.sameDayLastWeek(data, '2026-03-09')).toBeNull();
  });

  it('não cai para a pesagem anterior mais próxima', () => {
    // Comparar segunda com a sexta anterior mediria o fim de semana, não o
    // progresso: é justamente o que o SPEC quer evitar.
    const data = [w('2026-03-06', 84.0), w('2026-03-09', 84.5)];
    expect(DW.sameDayLastWeek(data, '2026-03-09')).toBeNull();
  });
});

describe('daysSincePreviousWeighIn', () => {
  const data = [w('2026-03-02', 85), w('2026-03-04', 84.8), w('2026-03-06', 84.6)];

  it('conta os dias desde a pesagem anterior', () => {
    expect(DW.daysSincePreviousWeighIn(data, '2026-03-06')).toBe(2);
    expect(DW.daysSincePreviousWeighIn(data, '2026-03-09')).toBe(3);
  });

  it('devolve nulo na primeira pesagem da história', () => {
    expect(DW.daysSincePreviousWeighIn(data, '2026-03-02')).toBeNull();
    expect(DW.daysSincePreviousWeighIn([], '2026-03-02')).toBeNull();
  });
});
