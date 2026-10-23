import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeReorg } from './core/organize/describe';
import { undoReorganize, type ReorgOutcome } from './core/organize/reorganize';
import { dexieRepo } from './db/dexieRepo';
import { moveMemoToTopic } from './db/repo';
import { getDb } from './db/schema';
import { motionBus } from './motion/bus';
import { requestLogin } from './organize/auth';
import { connectAnalyzer, getQueue } from './organize/runtime';
import { GlobeBoard } from './ui/globe/GlobeBoard';
import { LoginSheet } from './ui/LoginSheet';
import { MemoFocus } from './ui/MemoFocus';
import { Toast, type ToastState } from './ui/Toast';
import './ui/input.css';
import './ui/sheet.css';

export function App() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const toastId = useRef(0);

  const show = useCallback((message: string, opts?: { action?: ToastState['action']; ms?: number }) => {
    window.clearTimeout(timer.current);
    setToast({ id: ++toastId.current, message, action: opts?.action });
    timer.current = window.setTimeout(() => setToast(null), opts?.ms ?? 2600);
  }, []);
  const notify = useCallback((m: string) => show(m), [show]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const undo = useCallback(
    async (outcome: ReorgOutcome) => {
      if (!outcome.batchId) return;
      motionBus.emit({ type: 'undone', outcome }); // 보드가 같은 동작을 거꾸로 재생
      await undoReorganize(dexieRepo(), outcome.batchId);
      show('되돌렸어요');
    },
    [show],
  );

  useEffect(() => {
    const q = getQueue();
    const off = q.subscribe((e) => {
      if (e.type === 'organized') {
        // 글을 고쳐 다시 정돈한 메모는 제자리에 있었으므로 날아가는 연출이 없다
        if (e.outcome.edited) return;
        // 대기 카드의 현재 자리를 잡아 두면 보드가 거기서 출발하는 비행을 그린다
        const el = document.querySelector(`[data-pending-id="${e.outcome.memoId}"]`);
        const r = el?.getBoundingClientRect();
        motionBus.emit({
          type: 'departure',
          departure: {
            memoId: e.outcome.memoId,
            from: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
            newTopic: e.outcome.newTopic,
            topicId: e.outcome.topicId,
          },
        });
      } else if (e.type === 'reorganized') {
        motionBus.emit({ type: 'reorganized', outcome: e.outcome });
        // 알림 6초 + 되돌리기
        show(describeReorg(e.outcome), { ms: 6000, action: { label: '되돌리기', run: () => void undo(e.outcome) } });
      }
    });
    q.start();
    // 시작할 때 health가 401이면 로그인 칸을 한 번 연다(그전까지 대기열은 401에서 멈춘 채 메모를 pending으로 둔다)
    void connectAnalyzer().then((r) => {
      if (r === 'unauthorized') requestLogin();
    });
    return () => {
      off();
      q.stop();
    };
  }, [show, undo]);

  // 메모 상세 닫기: Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <GlobeBoard
          onSelectMemo={setSelected}
          onMoveToTopic={(memoId, topicId) =>
            void moveMemoToTopic(memoId, topicId).then(async () => {
              const t = await getDb().topics.get(topicId);
              notify(`'${t?.name ?? '주제'}' 무리로 옮겼어요`);
            })
          }
          notify={notify}
          panelOpen={!!selected}
        />
        <MemoFocus memoId={selected} onClose={() => setSelected(null)} onSelect={setSelected} notify={notify} />
        <Toast toast={toast} />
        <LoginSheet />
      </div>
    </MotionConfig>
  );
}
