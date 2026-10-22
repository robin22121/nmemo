import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { getDb, type Memo } from '../db/schema';

/** 아직 무리에 붙지 않은 메모(대기 + 실패), 오래된 순 */
export function usePending(): Memo[] {
  return useLiveQuery(
    async () => {
      // 글을 고쳐 다시 정돈 중인 메모는 보드 제자리에 그대로 있다(대기 칩 아님)
      const all = (await getDb().memos.where('status').anyOf('pending', 'failed').toArray()).filter((m) => !m.editReanalyze);
      return all.sort((a, b) => a.createdAt - b.createdAt);
    },
    [],
    [] as Memo[],
  );
}

/** Blob → object URL (정리까지 처리) */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function usePrefersReducedMotion(): boolean {
  const mq = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null),
    [],
  );
  const [v, setV] = useState(mq?.matches ?? false);
  useEffect(() => {
    if (!mq) return;
    const on = () => setV(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mq]);
  return v;
}
