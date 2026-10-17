import { Interval, IntervalStatus } from '@prisma/client';
import { invalid, IntervalFields } from './records.validation';

type Range = Pick<Interval, 'id' | 'startTime' | 'endTime'>;
export function intervalStatus(i: Pick<IntervalFields, 'startTime' | 'endTime'>): IntervalStatus {
  return i.startTime ? (i.endTime ? 'CLOSED' : 'OPEN') : i.endTime ? 'SEMI_CLOSED' : 'CLOSED';
}
export function validateInterval(i: IntervalFields, date: Date) {
  if (i.type === 'WORK' && (!i.startTime || !i.endTime))
    invalid('Un intervalo de trabajo manual debe tener inicio y fin');
  if (i.type !== 'ABSENCE' && i.absenceReason !== null)
    invalid('El motivo solo corresponde a una ausencia');
  const start = date.getTime() + 10800000,
    end = start + 86400000;
  if (i.startTime && (i.startTime.getTime() < start || i.startTime.getTime() >= end))
    invalid('El inicio debe pertenecer al día del registro en GMT-3');
  if (i.endTime && (i.endTime.getTime() < start || i.endTime.getTime() > end))
    invalid('El fin debe pertenecer al día del registro o a la medianoche siguiente');
  if (i.startTime && i.endTime && i.endTime < i.startTime)
    invalid('El fin no puede ser anterior al inicio');
}
function intersections(intervals: Range[]) {
  const result = new Map<string, [number, number]>();
  for (let a = 0; a < intervals.length; a++)
    for (let b = a + 1; b < intervals.length; b++) {
      const x = intervals[a],
        y = intervals[b];
      if (!x.startTime || !x.endTime || !y.startTime || !y.endTime) continue;
      const start = Math.max(x.startTime.getTime(), y.startTime.getTime()),
        end = Math.min(x.endTime.getTime(), y.endTime.getTime());
      if (start < end) result.set([x.id, y.id].sort().join(':'), [start, end]);
    }
  return result;
}
export function validateOverlaps(before: Range[], after: Range[]) {
  const old = intersections(before);
  for (const [pair, [start, end]] of intersections(after)) {
    const previous = old.get(pair);
    if (!previous || start < previous[0] || end > previous[1])
      invalid('No se permite crear o ampliar solapamientos de intervalos');
  }
}
export function projectIntervals(
  intervals: Pick<Interval, 'type' | 'startTime' | 'endTime' | 'intervalStatus'>[],
) {
  const ms = intervals.reduce(
    (sum, i) =>
      sum +
      (i.type === 'WORK' && i.intervalStatus === 'CLOSED' && i.startTime && i.endTime
        ? i.endTime.getTime() - i.startTime.getTime()
        : 0),
    0,
  );
  return {
    totalWorkMinutes: Math.floor(ms / 60000),
    recordStatus: intervals.every((i) => i.intervalStatus === 'CLOSED')
      ? ('COMPLETE' as const)
      : ('INCOMPLETE' as const),
  };
}
