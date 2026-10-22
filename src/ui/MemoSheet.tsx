import { motion, useReducedMotion } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { connectedTopics, visibleMoves } from '../core/connections';
import { BASIC_EMOTIONS } from '../core/palette';
import { MEMO_KINDS } from '../core/types';
import { deleteMemo, editMemoText, moveMemoToNewTopic, moveMemoToTopic, setDone, setMemoEmotion, setMemoKind } from '../db/repo';
import { getDb, type Memo } from '../db/schema';
import { motionBus } from '../motion/bus';
import { spring } from '../motion/presets';
import { getQueue } from '../organize/runtime';
import { GLOBE_ON, SHEET_STYLE } from './globe/config';
import { useObjectUrl } from './hooks';
import { CloseIcon, PenIcon } from './icons';

export const KIND_LABEL: Record<string, string> = { idea: '아이디어', emotion: '감정', observation: '관찰', todo: '할 일' };

const NEUTRAL = '#c9c2b0';
/** 메모장이 화면 가장자리에서 떨어지는 여백(px)과 모서리 */
const PAD = 12;
const PANEL_R = 32;

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

interface Box { left: number; top: number; width: number; height: number; r: number }

/** env(safe-area-inset-*)를 숫자로 읽는다 */
function insets(): { top: number; bottom: number } {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const r = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  p.remove();
  return r;
}

const keyboardOpen = () => {
  const vv = window.visualViewport;
  return !!vv && vv.height < window.innerHeight - 80;
};

/** 메모장의 자리: 보이는 화면(visual viewport) 위쪽에 붙고, 높이는 보이는 화면 − 위·아래 여백(§2.1·§2.5) */
function panelBox(): Box {
  const ins = insets();
  const vv = window.visualViewport;
  const top = ins.top + PAD;
  const vh = vv?.height ?? window.innerHeight;
  return {
    left: PAD,
    top: top + (vv?.offsetTop ?? 0),
    width: document.documentElement.clientWidth - PAD * 2,
    height: Math.max(160, vh - top - PAD - (keyboardOpen() ? 0 : ins.bottom)),
    r: PANEL_R,
  };
}

const cardSel = (id: string) => `.g-card[data-memo-id="${CSS.escape(id)}"]`;

/** 지구본 카드의 화면 사각형(회전 포함 외접)과 주제 색. 없거나 접혔거나 화면 밖이거나 지구본이 도는 중이면 null */
function cardBox(id: string): { box: Box; color: string } | null {
  const g = document.querySelector<HTMLElement>(cardSel(id));
  const c = g?.querySelector<HTMLElement>('.card');
  if (!g || !c || document.querySelector('[data-testid="board"][data-moving="1"]')) return null;
  const b = c.getBoundingClientRect();
  if (b.width < 4 || b.height < 4 || b.bottom < 0 || b.right < 0 || b.top > window.innerHeight || b.left > window.innerWidth) return null;
  const face = c.querySelector('.face');
  const rr = face ? getComputedStyle(face).borderTopLeftRadius : '0';
  const half = Math.min(b.width, b.height) / 2;
  const r = rr.endsWith('%') ? half : Math.min(parseFloat(rr) || 0, half);
  return {
    box: { left: b.left, top: b.top, width: b.width, height: b.height, r },
    color: g.closest<HTMLElement>('.g-cluster')?.style.getPropertyValue('--c') || NEUTRAL,
  };
}

const setCardHidden = (id: string, hidden: boolean) => {
  for (const g of document.querySelectorAll<HTMLElement>(cardSel(id))) g.style.visibility = hidden ? 'hidden' : '';
};

/** 편집 중 닫기: 자판이 내려갈 때까지(보이는 화면 높이 복귀) 또는 400ms 기다린다 */
function keyboardClosed(): Promise<void> {
  const vv = window.visualViewport;
  if (!vv || !keyboardOpen()) return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      window.clearTimeout(t);
      vv.removeEventListener('resize', on);
      res();
    };
    const on = () => {
      if (!keyboardOpen()) done();
    };
    const t = window.setTimeout(done, 400);
    vv.addEventListener('resize', on);
  });
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const autosize = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

interface BodyProps {
  memo: Memo;
  onClose: () => void;
  onSelect: (id: string) => void;
  notify: (m: string) => void;
  editing: boolean;
  draft: string;
  onDraft: (t: string) => void;
  startEdit: () => void;
  commitEdit: () => void;
  editRef: RefObject<HTMLTextAreaElement>;
  closeRef: RefObject<HTMLButtonElement>;
  drag: {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: RPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: RPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => void;
  };
}

function PanelBody({ memo, onClose, onSelect, notify, editing, draft, onDraft, startEdit, commitEdit, editRef, closeRef, drag }: BodyProps) {
  const url = useObjectUrl(memo.photo);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<'kind' | 'emotion' | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const topics = useLiveQuery(() => getDb().topics.toArray(), [], []);
  const topic = topics.find((t) => t.id === memo.topicId);
  const colorOf = (id?: string) => topics.find((t) => t.id === id)?.color ?? NEUTRAL;
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

  useLayoutEffect(() => autosize(editRef.current), [editing, editRef]);

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

  const photo = memo.input === 'photo';
  return (
    <>
      <div className="mp-drag" {...drag}>
        <div className="sheet-grabber mp-grabber" data-sheet-grabber aria-hidden />
        <div className="mp-head">
          {photo ? (
            <span className="mp-chip">사진</span>
          ) : (
            <button type="button" className={`mp-chip${pick === 'kind' ? ' on' : ''}`} data-testid="kind-chip" aria-expanded={pick === 'kind'} onClick={() => setPick((p) => (p === 'kind' ? null : 'kind'))}>
              {KIND_LABEL[memo.kind ?? 'idea']}
            </button>
          )}
          <button
            type="button"
            className={`mp-chip emo${pick === 'emotion' ? ' on' : ''}`}
            data-testid="emotion-chip"
            aria-expanded={pick === 'emotion'}
            style={{ ['--emo' as string]: memo.emotion?.color ?? NEUTRAL }}
            onClick={() => setPick((p) => (p === 'emotion' ? null : 'emotion'))}
          >
            <i /> {memo.emotion?.label ?? '감정'}
          </button>
          <span className="sheet-date mp-date">{fmtDate(memo.createdAt)}</span>
          {editing && (
            <button type="button" className="mp-done" data-testid="edit-done" onPointerDown={(e) => e.preventDefault()} onClick={commitEdit}>
              완료
            </button>
          )}
          <button type="button" ref={closeRef} className="sheet-close mp-close" data-testid="sheet-close" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>
      </div>
      {pick && (
        <div className="mp-pick" data-testid={`${pick}-pick`}>
          {pick === 'kind'
            ? MEMO_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mp-opt${memo.kind === k ? ' on' : ''}`}
                  data-testid={`kind-opt-${k}`}
                  aria-pressed={memo.kind === k}
                  onClick={() => {
                    void setMemoKind(memo.id, k);
                    setPick(null);
                  }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))
            : BASIC_EMOTIONS.map((e) => (
                <button
                  key={e.label}
                  type="button"
                  className={`mp-opt emo${memo.emotion?.label === e.label ? ' on' : ''}`}
                  data-testid={`emotion-opt-${e.label}`}
                  aria-pressed={memo.emotion?.label === e.label}
                  style={{ ['--emo' as string]: e.color }}
                  onClick={() => {
                    void setMemoEmotion(memo.id, e);
                    setPick(null);
                  }}
                >
                  <i /> {e.label}
                </button>
              ))}
        </div>
      )}

      <div className="sheet-scroll mp-scroll">
        {url && <img className="mp-photo" src={url} alt="" />}
        {editing ? (
          <textarea
            ref={editRef}
            className="mp-edit"
            data-testid="sheet-edit"
            aria-label="메모 고치기"
            rows={2}
            value={draft}
            placeholder={photo ? '사진 설명' : ''}
            onChange={(e) => {
              onDraft(e.target.value);
              autosize(e.target);
            }}
          />
        ) : (
          <div
            className="mp-text-wrap"
            role="button"
            tabIndex={0}
            aria-label="메모 고치기"
            data-testid="edit-text"
            onClick={startEdit}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              startEdit();
            }}
          >
            {memo.text ? (
              <p className="mp-text" data-testid="sheet-text">{memo.text}</p>
            ) : (
              <p className="mp-text mp-placeholder">{photo ? '사진 설명 붙이기' : '글 쓰기'}</p>
            )}
            <span className="mp-pen" aria-hidden>
              <PenIcon />
            </span>
          </div>
        )}
        {memo.editReanalyze && memo.status !== 'organized' && <p className="mp-status" data-testid="reanalyzing">고친 글로 다시 정돈하는 중…</p>}
        {memo.kind === 'todo' && (
          <button type="button" className={`mp-pill todo-toggle${memo.done ? ' on' : ''}`} data-testid="todo-toggle" aria-pressed={!!memo.done} onClick={() => void setDone(memo.id, !memo.done)}>
            {memo.done ? '완료했어요 · 눌러서 취소' : '완료로 표시'}
          </button>
        )}
        {memo.summary && memo.summary !== memo.text && <p className="mp-summary">요약 · {memo.summary}</p>}

        {memo.keywords && memo.keywords.length > 0 && (
          <div className="chips" aria-label="키워드">
            {memo.keywords.map((k) => (
              <span key={k} className="mp-kw">#{k}</span>
            ))}
          </div>
        )}

        <h3 className="mp-h">관련 메모</h3>
        {related.length === 0 ? (
          <p className="mp-empty">아직 이어진 메모가 없어요</p>
        ) : (
          <ul className="related-list" data-testid="related-list">
            {related.map((r) => (
              <li key={r.memo.id} style={{ ['--c' as string]: colorOf(r.memo.topicId) }}>
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
            <h3 className="mp-h">연결된 주제</h3>
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
                  <li key={c.topicId} data-conn-topic={c.topicId} style={{ ['--c' as string]: t?.color ?? NEUTRAL }}>
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
            <h3 className="mp-h">이동 기록</h3>
            <ul className="move-list" data-testid="move-list">
              {moves.map((m) => (
                <li key={m.id} style={{ ['--c' as string]: colorOf(m.toTopicId) }}>
                  <span className="move-line">
                    {fmtDate(m.at)} · {topicName(m.fromTopicId)} → {topicName(m.toTopicId)}
                  </span>
                  {m.reason && <span className="move-reason">{m.reason}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="mp-h">주제</h3>
        <div className="topic-row">
          <span className="topic-chip current" style={{ ['--c' as string]: topic?.color ?? NEUTRAL }}>
            {topic?.name ?? '정돈 전'}
          </span>
          <button type="button" className="mp-pill" data-testid="change-topic" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
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
              <button type="button" className="mp-pill danger" data-testid="confirm-delete" onClick={() => { void deleteMemo(memo.id); onClose(); }}>삭제</button>
              <button type="button" className="mp-pill" onClick={() => setConfirmDel(false)}>취소</button>
            </>
          ) : (
            <button type="button" className="mp-pill danger-text" data-testid="delete-memo" onClick={() => setConfirmDel(true)}>메모 삭제</button>
          )}
        </div>
      </div>
    </>
  );
}

type Phase = 'grow' | 'open' | 'closing' | 'shrink';

/**
 * 메모장(메모 상세, E1): 누른 지구본 카드 자리에서 카드 모양 그대로 커져 화면 위쪽에 붙고, 닫으면 카드 자리로 줄어든다.
 * 커지고 줄어드는 동안은 내용 없는 껍데기(top/left/width/height)만 움직이고, 다 커지면 실제 패널을 붙인다(§2.1).
 * 카드를 못 찾으면(평면 보드·접힘·삭제) 흐려지며 나타나고 사라진다. 자판이 열려도 패널은 보이는 화면 위에 붙어 있다(§2.5).
 */
export function MemoSheet({ memoId, onClose, onSelect, notify }: Props) {
  const reduced = !!useReducedMotion();
  const [shown, setShown] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [ghost, setGhost] = useState<{ from: Box; to: Box; fade: boolean } | null>(null);
  const [flipFrom, setFlipFrom] = useState<string | undefined>();
  const [tint, setTint] = useState(NEUTRAL);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const memoLive = useLiveQuery(() => (shown ? getDb().memos.get(shown) : undefined), [shown]);
  // 지워진 메모도 닫히는 동안은 마지막 모습으로 보여 준다
  const last = useRef<Memo | undefined>(undefined);
  if (memoLive) last.current = memoLive;
  const memo = memoLive ?? (last.current?.id === shown ? last.current : undefined);
  const topicColor = useLiveQuery(async () => (memo?.topicId ? (await getDb().topics.get(memo.topicId))?.color : undefined), [memo?.topicId]);
  const color = topicColor ?? tint;

  const panelRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const token = useRef(0);
  const prevFocus = useRef<Element | null>(null);
  const dragY = useRef(0);
  const dragAt = useRef<{ y0: number; t0: number } | null>(null);
  const apply = useRef<() => void>(() => {});
  const live = useRef({ shown, phase, editing, draft, reduced });
  live.current = { shown, phase, editing, draft, reduced };

  const commitEdit = useCallback(async () => {
    const { editing: on, draft: text, shown: id } = live.current;
    if (!on || !id) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement === editRef.current) document.activeElement.blur();
    setEditing(false);
    const r = await editMemoText(id, text);
    if (r === 'saved') {
      getQueue().wake();
      notify('고친 글로 다시 정돈해요');
    } else if (r === 'empty') notify('빈 메모는 저장하지 않았어요');
  }, [notify]);

  const startEdit = () => {
    if (!memo) return;
    // iOS는 손가락 이벤트 안에서 바로 포커스해야 자판이 열린다 → 동기로 그린 뒤 포커스
    flushSync(() => {
      setDraft(memo.text);
      setEditing(true);
    });
    const el = editRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };

  const finish = () => {
    const id = live.current.shown;
    if (id) setCardHidden(id, false);
    // 포커스는 카드(지구본) 또는 열기 전 자리로
    const g = id ? document.querySelector<HTMLElement>(cardSel(id)) : null;
    if (g) {
      g.tabIndex = -1;
      g.focus({ preventScroll: true });
    } else if (prevFocus.current instanceof HTMLElement && prevFocus.current.isConnected) prevFocus.current.focus({ preventScroll: true });
    dragY.current = 0;
    setShown(null);
    setPhase(null);
    setGhost(null);
    setEditing(false);
  };

  const startClose = async () => {
    const my = ++token.current;
    setPhase('closing');
    await commitEdit();
    await keyboardClosed();
    if (my !== token.current) return;
    // 내용이 먼저 사라지고 껍데기가 줄어든다
    if (!live.current.reduced) await sleep(140);
    if (my !== token.current) return;
    const id = live.current.shown;
    const p = panelRef.current?.getBoundingClientRect();
    const from: Box = p ? { left: p.left, top: p.top, width: p.width, height: p.height, r: PANEL_R } : panelBox();
    // 닫기 직전에 카드 자리를 다시 잰다(열린 동안 옮겨졌거나 사라졌을 수 있다)
    const c = id && !live.current.reduced ? cardBox(id) : null;
    setGhost({ from, to: c?.box ?? from, fade: !c });
    setPhase('shrink');
  };

  // 열기·바꾸기·닫기
  useLayoutEffect(() => {
    const { shown: cur, phase: ph } = live.current;
    if (memoId) {
      if (cur && memoId !== cur && (ph === 'open' || ph === 'grow')) {
        // 관련 메모를 누름: 메모장은 그대로, 내용만 바꾼다
        void commitEdit();
        setCardHidden(cur, false);
        setCardHidden(memoId, true);
        setShown(memoId);
        return;
      }
      if (cur && memoId === cur && (ph === 'open' || ph === 'grow')) return;
      token.current++; // 닫는 중이었으면 멈춘다
      if (cur) setCardHidden(cur, false);
      if (!cur) prevFocus.current = document.activeElement;
      const c = cardBox(memoId);
      setShown(memoId);
      setEditing(false);
      setFlipFrom(c ? [c.box.left, c.box.top, c.box.width, c.box.height].map((v) => v.toFixed(1)).join(',') : undefined);
      setTint(c?.color ?? NEUTRAL);
      setCardHidden(memoId, true);
      if (c && !live.current.reduced) {
        setGhost({ from: c.box, to: panelBox(), fade: false });
        setPhase('grow');
      } else {
        setGhost(null);
        setPhase('open');
      }
    } else if (cur && (ph === 'open' || ph === 'grow')) {
      void startClose();
    }
    // memoId가 바뀔 때만(나머지는 live 참조)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoId]);

  const panelOn = !!memo && (phase === 'open' || phase === 'closing');

  // 자판 흔들림 방지(E7): 보이는 화면이 바뀌거나 밀리면(iOS pan) 바로 패널 자리·높이를 맞춘다. transition 없음
  useLayoutEffect(() => {
    const p = panelRef.current;
    if (!panelOn || !p) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      const b = panelBox();
      p.style.transform = `translateY(${(window.visualViewport?.offsetTop ?? 0) + dragY.current}px)`;
      p.style.height = `${b.height}px`;
    };
    const req = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    apply.current = run;
    run();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', req);
    vv?.addEventListener('scroll', req);
    window.addEventListener('resize', req);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', req);
      vv?.removeEventListener('scroll', req);
      window.removeEventListener('resize', req);
      apply.current = () => {};
    };
  }, [panelOn]);

  // 열려 있는 동안 문서 자체는 스크롤되지 않는다
  useEffect(() => {
    if (!shown) return;
    document.documentElement.classList.add('mp-open');
    return () => document.documentElement.classList.remove('mp-open');
  }, [shown]);

  // 다 열리면 닫기 버튼으로 포커스
  useEffect(() => {
    if (phase === 'open' && panelOn) closeRef.current?.focus({ preventScroll: true });
  }, [phase, panelOn]);

  // 끌어 닫기: 손잡이·머리 줄에서만(안쪽 스크롤·글 선택과 겹치지 않게)
  const drag: BodyProps['drag'] = {
    onPointerDown: (e) => {
      if (live.current.phase !== 'open' || (e.target as Element).closest('button, input, textarea')) return;
      dragAt.current = { y0: e.clientY, t0: performance.now() };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (panelRef.current) panelRef.current.style.transition = 'none';
    },
    onPointerMove: (e) => {
      if (!dragAt.current) return;
      dragY.current = Math.max(0, e.clientY - dragAt.current.y0);
      apply.current();
    },
    onPointerUp: () => {
      const d = dragAt.current;
      if (!d) return;
      dragAt.current = null;
      const dy = dragY.current;
      const v = dy / Math.max(1, performance.now() - d.t0);
      if (dy > 90 || (v > 0.5 && dy > 20)) return onClose();
      const p = panelRef.current;
      if (p) p.style.transition = 'transform 0.2s ease';
      dragY.current = 0;
      apply.current();
      window.setTimeout(() => {
        if (p) p.style.transition = '';
      }, 220);
    },
    onPointerCancel: () => {
      dragAt.current = null;
      dragY.current = 0;
      apply.current();
    },
  };

  const box = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height, borderRadius: b.r });
  const closingNow = phase === 'closing' || phase === 'shrink';

  return (
    <>
      {shown && (
        <motion.div
          className="mp-backdrop"
          data-sheet={SHEET_STYLE}
          data-no-pan
          initial={{ opacity: 0 }}
          animate={{ opacity: closingNow ? 0 : 1 }}
          transition={{ duration: 0.25 }}
          onClick={() => live.current.phase === 'open' && onClose()}
        />
      )}
      {ghost && (phase === 'grow' || phase === 'shrink') && (
        <motion.div
          key={phase}
          className="mp-ghost"
          data-sheet={SHEET_STYLE}
          aria-hidden
          style={{ ['--c' as string]: color }}
          initial={{ ...box(ghost.from), opacity: 1 }}
          animate={ghost.fade ? { opacity: 0 } : { ...box(ghost.to), opacity: 1 }}
          transition={ghost.fade ? { duration: 0.2 } : spring.glide}
          onAnimationComplete={() => {
            if (live.current.phase === 'grow') setPhase('open');
            else if (live.current.phase === 'shrink') finish();
          }}
        />
      )}
      {panelOn && memo && (
        <motion.section
          ref={panelRef}
          className="mp-panel sheet-panel"
          data-sheet={SHEET_STYLE}
          data-testid="memo-sheet"
          data-flip-from={flipFrom}
          data-editing={editing ? '1' : undefined}
          data-no-pan
          role="dialog"
          aria-modal="true"
          aria-label="메모 상세"
          style={{ ['--c' as string]: color }}
          initial={{ opacity: ghost ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="mp-inner"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === 'closing' ? 0 : 1 }}
            transition={{ duration: phase === 'closing' ? 0.13 : 0.2 }}
          >
            <PanelBody
              memo={memo}
              onClose={onClose}
              onSelect={onSelect}
              notify={notify}
              editing={editing}
              draft={draft}
              onDraft={setDraft}
              startEdit={startEdit}
              commitEdit={() => void commitEdit()}
              editRef={editRef}
              closeRef={closeRef}
              drag={drag}
            />
          </motion.div>
        </motion.section>
      )}
    </>
  );
}
