import { describe, expect, it } from 'vitest';
import * as D from '../dates';

describe('conversão civil <-> dias desde a época', () => {
  it('ancora a época corretamente', () => {
    expect(D.toEpochDay('1970-01-01')).toBe(0);
    expect(D.fromEpochDay(0)).toBe('1970-01-01');
  });

  it('faz ida e volta em datas espalhadas por séculos', () => {
    for (const date of [
      '1900-01-01', '1969-12-31', '1970-01-01', '2000-02-29',
      '2024-02-29', '2026-09-15', '2100-03-01', '2399-12-31',
    ]) {
      expect(D.fromEpochDay(D.toEpochDay(date))).toBe(date);
    }
  });

  it('faz ida e volta em 20 anos corridos de dias', () => {
    const start = D.toEpochDay('2010-01-01');
    const end = D.toEpochDay('2030-01-01');
    for (let z = start; z <= end; z++) {
      expect(D.toEpochDay(D.fromEpochDay(z))).toBe(z);
    }
  });
});

describe('validação', () => {
  it('rejeita datas inexistentes no calendário', () => {
    expect(D.isValidDate('2026-02-30')).toBe(false);
    expect(D.isValidDate('2026-13-01')).toBe(false);
    expect(D.isValidDate('2026-00-10')).toBe(false);
    expect(D.isValidDate('2025-02-29')).toBe(false); // 2025 não é bissexto
  });

  it('rejeita formatos fora de YYYY-MM-DD', () => {
    expect(D.isValidDate('15/09/2026')).toBe(false);
    expect(D.isValidDate('2026-9-15')).toBe(false);
    expect(D.isValidDate('')).toBe(false);
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(D.isValidDate('2024-02-29')).toBe(true);
    expect(D.isValidDate('2000-02-29')).toBe(true); // divisível por 400
    expect(D.isValidDate('1900-02-29')).toBe(false); // divisível por 100, não por 400
  });
});

describe('aritmética', () => {
  it('atravessa virada de mês e de ano', () => {
    expect(D.addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(D.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(D.addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('atravessa 29 de fevereiro', () => {
    expect(D.addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(D.addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(D.addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('conta dias entre datas, com sinal', () => {
    expect(D.daysBetween('2026-09-14', '2026-09-16')).toBe(2); // seg -> qua
    expect(D.daysBetween('2026-09-18', '2026-09-21')).toBe(3); // sex -> seg
    expect(D.daysBetween('2026-09-16', '2026-09-14')).toBe(-2);
    expect(D.daysBetween('2026-09-15', '2026-09-15')).toBe(0);
  });

  it('conta o ano bissexto inteiro', () => {
    expect(D.daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(D.daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });

  it('não é afetado pela virada do horário de verão', () => {
    // No antigo DST brasileiro a meia-noite de 2018-11-04 não existia no fuso local.
    // Com aritmética inteira isso é irrelevante: o dia seguinte é o dia seguinte.
    expect(D.addDays('2018-11-03', 1)).toBe('2018-11-04');
    expect(D.daysBetween('2018-11-03', '2018-11-05')).toBe(2);
    expect(D.addDays('2018-02-17', 1)).toBe('2018-02-18'); // volta do DST
  });
});

describe('dia da semana', () => {
  it('identifica dias conhecidos', () => {
    expect(D.dayOfWeek('1970-01-01')).toBe(4); // quinta
    expect(D.dayOfWeek('2026-09-14')).toBe(1); // segunda
    expect(D.dayOfWeek('2026-09-16')).toBe(3); // quarta
    expect(D.dayOfWeek('2026-09-18')).toBe(5); // sexta
    expect(D.dayOfWeek('2026-09-20')).toBe(0); // domingo
  });

  it('funciona antes da época, onde o resto de % é negativo em JS', () => {
    expect(D.dayOfWeek('1969-12-31')).toBe(3); // quarta
    expect(D.dayOfWeek('1900-01-01')).toBe(1); // segunda
  });

  it('dá rótulos em português', () => {
    expect(D.weekdayShort('2026-09-14')).toBe('seg');
    expect(D.weekdayShort('2026-09-18')).toBe('sex');
    expect(D.weekdayLong('2026-09-16')).toBe('quarta-feira');
  });
});

describe('semana ISO de segunda a domingo', () => {
  it('leva qualquer dia da semana para a mesma segunda', () => {
    // 2026-09-14 (seg) a 2026-09-20 (dom) são a mesma semana.
    for (const date of [
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
      '2026-09-18', '2026-09-19', '2026-09-20',
    ]) {
      expect(D.weekStart(date)).toBe('2026-09-14');
      expect(D.weekEnd(date)).toBe('2026-09-20');
    }
  });

  it('coloca domingo na semana que começou na segunda anterior, não na seguinte', () => {
    // A armadilha clássica de quem usa getDay() sem tratar o 0.
    expect(D.weekStart('2026-09-20')).toBe('2026-09-14');
    expect(D.weekStart('2026-09-21')).toBe('2026-09-21'); // a segunda seguinte
  });

  it('a segunda seguinte fica exatamente 7 dias depois', () => {
    expect(D.daysBetween(D.weekStart('2026-09-16'), D.weekStart('2026-09-23'))).toBe(7);
  });

  it('numera semanas ISO em viradas de ano difíceis', () => {
    // 2026-01-01 é quinta: pertence à semana 1 de 2026.
    expect(D.isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
    // 2027-01-01 é sexta: ainda é a semana 53 de 2026.
    expect(D.isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    // 2021-01-01 é sexta: semana 53 de 2020.
    expect(D.isoWeek('2021-01-01')).toEqual({ year: 2020, week: 53 });
    // 2024-12-30 é segunda: já é a semana 1 de 2025.
    expect(D.isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
  });
});

describe('formatação brasileira', () => {
  it('formata DD/MM e DD/MM/AAAA', () => {
    expect(D.formatDayMonth('2026-09-05')).toBe('05/09');
    expect(D.formatFull('2026-09-05')).toBe('05/09/2026');
  });
});

describe('todayISO', () => {
  it('usa a data local, não a UTC', () => {
    // 23h de 15/09 em horário local. Em qualquer fuso negativo o equivalente UTC
    // já é dia 16; toISOString() devolveria a data errada. Aqui tem que dar 15.
    const localLateNight = new Date(2026, 8, 15, 23, 30, 0);
    expect(D.todayISO(localLateNight)).toBe('2026-09-15');
  });

  it('formata mês e dia com dois dígitos', () => {
    expect(D.todayISO(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});
