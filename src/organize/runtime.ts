import { OrganizeQueue } from '../core/organize/queue';
import { AuthError } from '../core/organize/types';
import { dexieRepo } from '../db/dexieRepo';
import { requestLogin } from './auth';
import { readPhotoBase64 } from './photo';
import { detectAnalyzer, RemoteAnalyzer } from './remote';

let queue: OrganizeQueue | null = null;

/** 앱 전체에서 하나만 쓰는 정돈 대기열. 분석기는 /api/health로 자동 선택된다. 401이면 멈추고 로그인 칸을 연다. */
export function getQueue(): OrganizeQueue {
  if (!queue) {
    queue = new OrganizeQueue(dexieRepo(), () => detectAnalyzer(), {
      readPhoto: readPhotoBase64,
      onWakeSignal: (wake) => {
        window.addEventListener('online', wake);
        return () => window.removeEventListener('online', wake);
      },
      onAuthRequired: requestLogin,
    });
  }
  return queue;
}

/**
 * `/api/health`를 (저장된 로그인 정보로) 다시 확인해 대기열 분석기를 바꾼다. 새로 고침 없이.
 * 401이면 분석기는 그대로 두고 'unauthorized'.
 */
export async function connectAnalyzer(): Promise<'remote' | 'local' | 'unauthorized'> {
  try {
    const a = await detectAnalyzer();
    getQueue().setAnalyzer(a);
    return a instanceof RemoteAnalyzer ? 'remote' : 'local';
  } catch (e) {
    if (e instanceof AuthError) return 'unauthorized';
    throw e;
  }
}

export function resetQueue(): void {
  queue?.stop();
  queue = null;
}
