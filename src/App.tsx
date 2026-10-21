import { MotionConfig } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeReorg } from './core/organize/describe';
import { undoReorganize, type ReorgOutcome } from './core/organize/reorganize';
import { dexieRepo } from './db/dexieRepo';
import { moveMemoToNewTopic, moveMemoToTopic, renameTopic } from './db/repo';
import { getDb } from './db/schema';
import { motionBus } from './motion/bus';
import { getQueue } from './organize/runtime';
import { Board } from './ui/Board';
import { ClusterBar } from './ui/ClusterBar';
import { InputBar } from './ui/InputBar';
import { MemoSheet } from './ui/MemoSheet';
import { NewTopicDialog } from './ui/NewTopicDialog';
import { PendingTray } from './ui/PendingTray';
import { Toast, type ToastState } from './ui/Toast';
import { usePending } from './ui/hooks';
import './ui/input.css';
import './ui/sheet.css';

export function App() {
  const pending = usePending();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [newTopicFor, setNewTopicFor] = useState<string | null>(null);
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
    return () => {
      off();
      q.stop();
    };
  }, [show, undo]);

  const wake = useCallback(() => getQueue().wake(), []);

  // 메모 상세/무리 상세 닫기: Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (openCluster) setOpenCluster(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, openCluster]);

  // undefined = 아직 읽는 중, null = 없음
  const cluster = useLiveQuery(async () => (openCluster ? ((await getDb().topics.get(openCluster)) ?? null) : undefined), [openCluster]);
  const clusterCount = useLiveQuery(
    () => (openCluster ? getDb().memos.where('topicId').equals(openCluster).count() : 0),
    [openCluster],
    0,
  );
  // 열려 있던 무리가 사라지면(빈 주제 삭제 등) 닫는다
  useEffect(() => {
    if (openCluster && cluster === null) setOpenCluster(null);
  }, [openCluster, cluster]);

  const draggedMemo = useLiveQuery(() => (newTopicFor ? getDb().memos.get(newTopicFor) : undefined), [newTopicFor]);

  const selectMemo = useCallback(
    async (id: string | null) => {
      setSelected(id);
      if (id && openCluster) {
        const m = await getDb().memos.get(id);
        if (m && m.topicId !== openCluster) setOpenCluster(null);
      }
    },
    [openCluster],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Board
          selectedMemoId={selected}
          openClusterId={openCluster}
          onSelectMemo={(id) => void selectMemo(id)}
          onOpenCluster={(id) => {
            setSelected(null);
            setOpenCluster(id);
          }}
          onMoveToTopic={(memoId, topicId) =>
            void moveMemoToTopic(memoId, topicId).then(async () => {
              const t = await getDb().topics.get(topicId);
              notify(`'${t?.name ?? '주제'}' 무리로 옮겼어요`);
            })
          }
          onMoveToNew={(memoId) => setNewTopicFor(memoId)}
        />
        <ClusterBar
          topic={cluster ?? null}
          count={clusterCount}
          onBack={() => {
            setSelected(null);
            setOpenCluster(null);
          }}
          onRename={(name) => {
            if (!openCluster) return;
            void renameTopic(openCluster, name).then(wake);
          }}
        />
        <div className="dock">
          <PendingTray memos={pending} onRetry={(id) => void getQueue().retry(id)} />
          <InputBar notify={notify} onSaved={wake} />
        </div>
        <MemoSheet memoId={selected} onClose={() => setSelected(null)} onSelect={(id) => void selectMemo(id)} notify={notify} />
        <NewTopicDialog
          open={newTopicFor !== null}
          suggestion={draggedMemo?.keywords?.[0] ?? ''}
          onCancel={() => setNewTopicFor(null)}
          onCreate={(name) => {
            const id = newTopicFor;
            setNewTopicFor(null);
            if (id) void moveMemoToNewTopic(id, name).then(() => notify(`'${name}' 무리를 만들었어요`));
          }}
        />
        <Toast toast={toast} />
      </div>
    </MotionConfig>
  );
}
