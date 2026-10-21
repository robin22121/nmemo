import { OrganizeQueue } from '../core/organize/queue';
import { dexieRepo } from '../db/dexieRepo';
import { readPhotoBase64 } from './photo';
import { detectAnalyzer } from './remote';

let queue: OrganizeQueue | null = null;

/** 앱 전체에서 하나만 쓰는 정돈 대기열. 분석기는 /api/health로 자동 선택된다. */
export function getQueue(): OrganizeQueue {
  if (!queue) {
    queue = new OrganizeQueue(dexieRepo(), () => detectAnalyzer(), {
      readPhoto: readPhotoBase64,
      onWakeSignal: (wake) => {
        window.addEventListener('online', wake);
        return () => window.removeEventListener('online', wake);
      },
    });
  }
  return queue;
}

export function resetQueue(): void {
  queue?.stop();
  queue = null;
}
