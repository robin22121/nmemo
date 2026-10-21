import { useCallback, useEffect, useRef, useState } from 'react';
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
    q.start();
    return () => q.stop();
  }, []);

  const wake = useCallback(() => getQueue().wake(), []);

  return (
    <div className="app">
      <Board />
      <div className="dock">
        <PendingTray memos={pending} onRetry={(id) => void getQueue().retry(id)} />
        <InputBar notify={notify} onSaved={wake} />
      </div>
      <Toast message={toast} />
    </div>
  );
}
