/** 정돈 대기열(App)과 보드(Board)를 잇는 아주 작은 이벤트 통로. 보드가 움직임을 연출할 때 쓴다. */
import type { ReorgOutcome } from '../core/organize/reorganize';

export interface Departure {
  memoId: string;
  /** 출발한 대기 카드의 화면 중심(없으면 화면 아래쪽 가운데) */
  from: { x: number; y: number } | null;
  newTopic: boolean;
  topicId: string;
}

type Msg = { type: 'departure'; departure: Departure } | { type: 'reorganized'; outcome: ReorgOutcome } | { type: 'undone'; outcome: ReorgOutcome };

const subs = new Set<(m: Msg) => void>();

export const motionBus = {
  emit(m: Msg) {
    for (const s of subs) s(m);
  },
  subscribe(fn: (m: Msg) => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
