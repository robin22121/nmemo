import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { connectedTopics, visibleMoves } from '../core/connections';
import { deleteMemo, moveMemoToNewTopic, moveMemoToTopic, setDone } from '../db/repo';
import { getDb, type Memo } from '../db/schema';
import { motionBus } from '../motion/bus';
import { spring } from '../motion/presets';
import { GLOBE_ON } from './globe/config';
import { useObjectUrl } from './hooks';
import { CloseIcon } from './icons';

export const KIND_LABEL: Record<string, string> = { idea: '아이디어', emotion: '감정', observation: '관찰', todo: '할 일' };

interface Props {
  memoId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  notify: (m: string) => void;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function SheetBody({ memo, onClose, onSelect, notify }: { memo: Memo; onClose: () => void; onSelect: (id: string) => void; notify: (m: string) => void }) {
  const url = useObjectUrl(memo.photo);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const topics = useLiveQuery(() => getDb().topics.toArray(), [], []);
  const topic = topics.find((t) => t.id === memo.topicId);
  const related = useLiveQuery(
    async () => {
      const db = getDb();
      const ls = [
        ...(await db.links.where('fromId').equals(memo.id).toArray()),
        ...(await db.links.where('toId').equals(memo.id).toArray()),
      ];
      const out: { memo: Memo; strength: number; reason: string }[] = [];
      for (const l of ls) {
        const other = await db.memos.get(l.fromId === memo.id ? l.toId : l.fromId);
        if (other) out.push({ memo: other, strength: l.strength, reason: l.reason });
      }
      return out.sort((a, b) => b.strength - a.strength);
    },
    [memo.id],
    [],
  );
  // 고정 메모가 이어진 다른 주제들(D25)
  const conns = useMemo(
    () => connectedTopics([memo, ...related.map((r) => r.memo)], related.map((r) => ({ fromId: memo.id, toId: r.memo.id, strength: r.strength, reason: r.reason }))).get(memo.id) ?? [],
    [memo, related],
  );
  const relById = useMemo(() => new Map(related.map((r) => [r.memo.id, r.memo])), [related]);
  // AI 재정리로 옮겨진 기록, 되돌린 묶음 제외, 최근 것부터(D26)
  const moves = useLiveQuery(
    async () => {
      const db = getDb();
      const ms = await db.moves.where('memoId').equals(memo.id).toArray();
      const bs = await db.batches.bulkGet([...new Set(ms.map((m) => m.batchId))]);
      return visibleMoves(ms, bs.filter((b) => !!b));
    },
    [memo.id],
    [],
  );
  const topicName = (id: string) => topics.find((t) => t.id === id)?.name ?? '(사라진 주제)';

  const choose = async (topicId: string) => {
    if (topicId !== memo.topicId) {
      await moveMemoToTopic(memo.id, topicId);
      notify('주제를 옮겼어요');
    }
    setPicking(false);
  };
  const createTopic = async () => {
    const name = newName.trim();
    if (!name) return;
    await moveMemoToNewTopic(memo.id, name);
    setNewName('');
    setPicking(false);
    notify(`'${name}' 주제를 만들었어요`);
  };

  return (
    <>
      <div className="sheet-head">
        <span className="chip kind">{memo.input === 'photo' ? '사진' : KIND_LABEL[memo.kind ?? 'idea']}</span>
        {memo.emotion && (
          <span className="chip emo" style={{ ['--emo' as string]: memo.emotion.color }}>
            <i /> {memo.emotion.label}
          </span>
        )}
        <span className="sheet-date">{fmtDate(memo.createdAt)}</span>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
          <CloseIcon />
        </button>
      </div>

      <div className="sheet-scroll">
        {url && <img className="sheet-photo" src={url} alt="" />}
        {memo.text && <p className="sheet-text" data-testid="sheet-text">{memo.text}</p>}
        {memo.kind === 'todo' && (
          <button type="button" className={`todo-toggle${memo.done ? ' on' : ''}`} onClick={() => void setDone(memo.id, !memo.done)}>
            {memo.done ? '완료했어요 · 눌러서 취소' : '완료로 표시'}
          </button>
        )}
        {memo.summary && memo.summary !== memo.text && <p className="sheet-summary">요약 · {memo.summary}</p>}

        {memo.keywords && memo.keywords.length > 0 && (
          <div className="chips" aria-label="키워드">
            {memo.keywords.map((k) => (
              <span key={k} className="chip kw">#{k}</span>
            ))}
          </div>
        )}

        <h3 className="sheet-h">관련 메모</h3>
        {related.length === 0 ? (
          <p className="sheet-empty">아직 이어진 메모가 없어요</p>
        ) : (
          <ul className="related-list" data-testid="related-list">
            {related.map((r) => (
              <li key={r.memo.id}>
                <button type="button" onClick={() => onSelect(r.memo.id)}>
                  <span className="rel-text">{r.memo.summary || r.memo.text || '사진'}</span>
                  <span className="rel-reason">{r.reason || '내용이 이어져요'}</span>
                  <span className="rel-bar" style={{ width: `${Math.round(r.strength * 100)}%` }} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {conns.length > 0 && (
          <>
            <h3 className="sheet-h">연결된 주제</h3>
            <ul className="conn-list" data-testid="conn-list">
              {conns.map((c) => {
                const t = topics.find((x) => x.id === c.topicId);
                const head = (
                  <>
                    <i />
                    <span className="conn-name">{t?.name ?? '(사라진 주제)'}</span>
                  </>
                );
                return (
                  <li key={c.topicId} data-conn-topic={c.topicId} style={{ ['--c' as string]: t?.color ?? '#ccc' }}>
                    {GLOBE_ON && t ? (
                      <button
                        type="button"
                        className="conn-head"
                        onClick={() => {
                          motionBus.emit({ type: 'focusTopic', topicId: c.topicId });
                          onClose();
                        }}
                      >
                        {head}
                      </button>
                    ) : (
                      <div className="conn-head">{head}</div>
                    )}
                    {c.links.map((l) => {
                      const m = relById.get(l.memoId);
                      return (
                        <p key={l.memoId} className="conn-link">
                          {m ? m.summary || m.text || '사진' : ''}
                          <span> · {l.reason || '내용이 이어져요'}</span>
                        </p>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {moves.length > 0 && (
          <>
            <h3 className="sheet-h">이동 기록</h3>
            <ul className="move-list" data-testid="move-list">
              {moves.map((m) => (
                <li key={m.id}>
                  <span className="move-line">
                    {fmtDate(m.at)} · {topicName(m.fromTopicId)} → {topicName(m.toTopicId)}
                  </span>
                  {m.reason && <span className="move-reason">{m.reason}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="sheet-h">주제</h3>
        <div className="topic-row">
          <span className="topic-chip current" style={{ ['--c' as string]: topic?.color ?? '#ccc' }}>
            {topic?.name ?? '정돈 전'}
          </span>
          <button type="button" className="link-btn" data-testid="change-topic" onClick={() => setPicking((v) => !v)}>
            {picking ? '접기' : '주제 바꾸기'}
          </button>
        </div>
        {picking && (
          <div className="topic-pick" data-testid="topic-pick">
            <div className="chips">
              {topics.filter((t) => t.id !== memo.topicId).map((t) => (
                <button key={t.id} type="button" className="topic-chip" style={{ ['--c' as string]: t.color }} onClick={() => void choose(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
            <form
              className="new-topic"
              onSubmit={(e) => {
                e.preventDefault();
                void createTopic();
              }}
            >
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 주제 이름" aria-label="새 주제 이름" maxLength={24} />
              <button type="submit" disabled={!newName.trim()}>만들기</button>
            </form>
          </div>
        )}

        <div className="danger-row">
          {confirmDel ? (
            <>
              <span>정말 지울까요?</span>
              <button type="button" className="danger" data-testid="confirm-delete" onClick={() => { void deleteMemo(memo.id); onClose(); }}>삭제</button>
              <button type="button" className="link-btn" onClick={() => setConfirmDel(false)}>취소</button>
            </>
          ) : (
            <button type="button" className="link-btn danger-text" data-testid="delete-memo" onClick={() => setConfirmDel(true)}>메모 삭제</button>
          )}
        </div>
      </div>
    </>
  );
}

/** 메모 상세 바텀 시트. 아래로 끌어 내리면 닫힌다. 열려 있는 동안 보드는 관련 메모를 강조한다. */
export function MemoSheet({ memoId, onClose, onSelect, notify }: Props) {
  const memo = useLiveQuery(() => (memoId ? getDb().memos.get(memoId) : undefined), [memoId]);
  const controls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 500) onClose();
  };
  return (
    <AnimatePresence>
      {memoId && memo && (
        <motion.section
          key="sheet"
          className="sheet"
          data-testid="memo-sheet"
          role="dialog"
          aria-label="메모 상세"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={spring.glide}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          dragListener={false}
          dragControls={controls}
          onDragEnd={onDragEnd}
        >
          <div className="sheet-grabber" data-sheet-grabber onPointerDown={(e) => controls.start(e)} aria-hidden />
          <SheetBody memo={memo} onClose={onClose} onSelect={onSelect} notify={notify} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}
