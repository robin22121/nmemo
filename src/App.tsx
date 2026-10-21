import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motionBus } from './motion/bus';
import { getQueue } from './organize/runtime';
import { Board } from './ui/Board';
import { InputBar } from './ui/InputBar';
import { PendingTray } from './ui/PendingTray';
import { Toast } from './ui/Toast';
import { usePending } from './ui/hooks';
import './ui/input.css';

export function App() {
  const pending = usePending();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>(0);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const q = getQueue();
    const off = q.subscribe((e) => {
      if (e.type === 'organized') {
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
      }
    });
    q.start();
    return () => {
      off();
      q.stop();
    };
  }, []);

  const wake = useCallback(() => getQueue().wake(), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Board />
        <div className="dock">
          <PendingTray memos={pending} onRetry={(id) => void getQueue().retry(id)} />
          <InputBar notify={notify} onSaved={wake} />
        </div>
        <Toast message={toast} />
      </div>
    </MotionConfig>
  );
}
