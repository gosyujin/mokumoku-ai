// JST(UTC+9 固定)の日時計算。ランナーのタイムゾーンに依存しないよう、Date の UTC 系だけを使う。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 稼働時間(JST)。開始 7:00、終了 23:30(両端を含む) */
export const ACTIVE_FROM_MIN = 7 * 60;
export const ACTIVE_TO_MIN = 23 * 60 + 30;

/** 前回の起床からこの分数未満なら二重起動とみなす */
export const MIN_INTERVAL_MIN = 20;

/** 同じ日のうちに、前回からこの分数を超えていたら「起床の欠落」とみなす */
export const GAP_WARN_MIN = 45;

export interface JstParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  hhmm: string;
  hour: number;
  /** 0時からの経過分 */
  minuteOfDay: number;
}

export function jst(now: Date): JstParts {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const iso = shifted.toISOString(); // 例: 2026-11-24T10:07:00.000Z(Z は無視する)
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    date: iso.slice(0, 10),
    hhmm: iso.slice(11, 16),
    hour,
    minuteOfDay: hour * 60 + minute,
  };
}

export function isActiveHours(now: Date): boolean {
  const m = jst(now).minuteOfDay;
  return m >= ACTIVE_FROM_MIN && m <= ACTIVE_TO_MIN;
}

/** 経過分(切り捨て)。lastBeat が無い・壊れている場合は null */
export function minutesSince(now: Date, lastBeat: string | null | undefined): number | null {
  if (!lastBeat) return null;
  const t = Date.parse(lastBeat);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 60000);
}

export type Gate =
  | { kind: "outside-hours" }
  | { kind: "too-soon"; minutes: number }
  | { kind: "run"; elapsedMinutes: number | null };

/** LLM を使わない最初の関門。稼働時間外と二重起動をここで落とす */
export function gate(now: Date, lastBeat: string | null | undefined): Gate {
  if (!isActiveHours(now)) return { kind: "outside-hours" };
  const elapsed = minutesSince(now, lastBeat);
  if (elapsed !== null && elapsed >= 0 && elapsed < MIN_INTERVAL_MIN) {
    return { kind: "too-soon", minutes: elapsed };
  }
  return { kind: "run", elapsedMinutes: elapsed };
}
