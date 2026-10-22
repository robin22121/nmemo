import type { Memo } from './types';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyStats {
  /** 최근 7일(now−7일 ≤ organizedAt ≤ now) 처음 정돈된 메모 수 */
  organized: number;
  /** 그중 정돈 뒤 7일 안(organizedAt ≤ lockedAt ≤ organizedAt+7일)에 사용자가 직접 옮긴 수 */
  moved: number;
  /** moved / organized. 정돈된 메모가 없으면 null(화면에는 "—") */
  rate: number | null;
}

/** 오분류율 기록(Z5, 0단계 §2). 기존 메모는 organizedAt이 없어 세지 않는다 */
export function weeklyStats(memos: Pick<Memo, 'organizedAt' | 'lockedAt'>[], now: number): WeeklyStats {
  let organized = 0;
  let moved = 0;
  for (const m of memos) {
    const o = m.organizedAt;
    if (o === undefined || o < now - WEEK || o > now) continue;
    organized++;
    if (m.lockedAt !== undefined && m.lockedAt >= o && m.lockedAt <= o + WEEK) moved++;
  }
  return { organized, moved, rate: organized === 0 ? null : moved / organized };
}
