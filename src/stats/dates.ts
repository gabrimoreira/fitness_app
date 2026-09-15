/**
 * Aritmética de datas civis sobre strings `YYYY-MM-DD`.
 *
 * POR QUE NÃO USAR `Date` AQUI: `new Date('2026-09-15')` é especificado como UTC
 * meia-noite, então em qualquer fuso negativo (o Brasil inteiro) ele retorna o dia
 * 14 ao ser lido com `getDate()`. Um app cujo domínio é "que dia você se pesou"
 * não pode ter essa classe de erro. Todo o módulo trabalha com dias inteiros desde
 * a época, pelo algoritmo de calendário civil de Howard Hinnant, que é exato e
 * completamente independente de fuso horário.
 *
 * A única conversão para `Date` acontece em `todayISO()`, e é deliberada: ali o
 * que se quer é justamente a data local do usuário.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dias desde 1970-01-01 para uma data civil. Válido para qualquer ano. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yAdj = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yAdj >= 0 ? yAdj : yAdj - 399) / 400);
  const yoe = yAdj - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverso de `daysFromCivil`. */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** Valida e converte `YYYY-MM-DD` em dias desde a época. Lança se for inválida. */
export function toEpochDay(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Data inválida (esperado YYYY-MM-DD): ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const epochDay = daysFromCivil(y, m, d);
  // Detecta datas sintaticamente corretas mas inexistentes (2026-02-30, 2026-13-01).
  const back = civilFromDays(epochDay);
  if (back.y !== y || back.m !== m || back.d !== d) {
    throw new Error(`Data inexistente no calendário: ${date}`);
  }
  return epochDay;
}

/** Converte dias desde a época em `YYYY-MM-DD`. */
export function fromEpochDay(epochDay: number): string {
  const { y, m, d } = civilFromDays(epochDay);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isValidDate(date: string): boolean {
  try {
    toEpochDay(date);
    return true;
  } catch {
    return false;
  }
}

/** Dias de `from` até `to`. Positivo se `to` for posterior. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDays(date: string, n: number): string {
  return fromEpochDay(toEpochDay(date) + n);
}

/** 0=domingo, 1=segunda ... 6=sábado. Mesma convenção de `Date.getDay()`. */
export function dayOfWeek(date: string): number {
  // 1970-01-01 foi quinta-feira (4). O +11 garante resultado positivo para
  // datas anteriores à época, onde o resto de `%` em JS é negativo.
  return ((toEpochDay(date) % 7) + 11) % 7;
}

/** Segunda-feira da semana ISO que contém `date`. É a chave de agrupamento semanal. */
export function weekStart(date: string): string {
  const dow = dayOfWeek(date);
  // domingo (0) pertence à semana que começou na segunda anterior, 6 dias atrás.
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return addDays(date, -daysSinceMonday);
}

/** Domingo que fecha a semana ISO que contém `date`. */
export function weekEnd(date: string): string {
  return addDays(weekStart(date), 6);
}

/**
 * Número e ano da semana ISO 8601. Usado só para rótulo; o agrupamento usa a data
 * da segunda-feira, que não tem as ambiguidades de virada de ano da numeração ISO.
 */
export function isoWeek(date: string): { year: number; week: number } {
  const monday = weekStart(date);
  // Pela definição ISO, o ano da semana é o ano da quinta-feira dela.
  const thursday = addDays(monday, 3);
  const { y } = civilFromDays(toEpochDay(thursday));
  const jan4 = `${String(y).padStart(4, '0')}-01-04`;
  const firstMonday = weekStart(jan4);
  const week = Math.floor(daysBetween(firstMonday, monday) / 7) + 1;
  return { year: y, week };
}

/** Rótulo curto da semana, ex.: "S38/2026". */
export function isoWeekLabel(date: string): string {
  const { year, week } = isoWeek(date);
  return `S${String(week).padStart(2, '0')}/${year}`;
}

/** Data local de hoje como `YYYY-MM-DD`. Único ponto do módulo que olha o relógio. */
export function todayISO(now: Date = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const WEEKDAY_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT[dayOfWeek(date)] ?? '';
}

export function weekdayLong(date: string): string {
  return WEEKDAY_LONG[dayOfWeek(date)] ?? '';
}

export function weekdayShortFromIndex(dow: number): string {
  return WEEKDAY_SHORT[dow] ?? '';
}

/** Formato de exibição do app: DD/MM. */
export function formatDayMonth(date: string): string {
  const match = DATE_RE.exec(date);
  if (!match) return date;
  return `${match[3]}/${match[2]}`;
}

/** DD/MM/AAAA, para contextos em que o ano importa (importação, backup). */
export function formatFull(date: string): string {
  const match = DATE_RE.exec(date);
  if (!match) return date;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
