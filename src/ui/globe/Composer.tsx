import { useEffect, useRef, useState } from 'react';
import { addMemo } from '../../db/repo';
import { getQueue } from '../../organize/runtime';
import { CameraIcon, MicIcon, SendIcon } from '../icons';
import { resizeImage } from '../image';
import { isSpeechSupported, startListening, type Listening } from '../speech';

interface Props {
  draft: string;
  onDraft: (t: string) => void;
  /** 저장 직후(쓰기 칸을 닫고 지구본으로) */
  onSaved: () => void;
  /** 저장 없이 닫기(덮개 탭·Esc). 초안은 남는다 */
  onDismiss: () => void;
  notify: (m: string) => void;
}

/**
 * 바로 쓰기(§3.4): 정면에 큰 쓰기 칸, 뒤에는 반투명 덮개 너머로 지구본이 천천히 돈다.
 * 데스크톱은 첫 키 입력이 바로 들어오고, iOS는 가짜 커서를 그려 두고 한 번 탭하면 입력이 시작된다.
 * + → [녹음](누르고 있는 동안 듣기) [사진]. 저장은 기존 경로(addMemo → pending → 대기열 깨우기) 후 쓰기 칸이 닫힌다(D6).
 */
export function GlobeComposer({ draft, onDraft, onSaved, onDismiss, notify }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listenRef = useRef<Listening | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [plus, setPlus] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  // 데스크톱: 탭 없이 첫 키 입력이 쓰기 칸으로 간다(키다운 중에 포커스를 옮기면 그 글자가 새 칸에 들어간다)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = textRef.current;
      if (!el || document.activeElement === el || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Process') el.focus();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  useEffect(() => () => listenRef.current?.abort(), []);

  const save = async (input: 'text' | 'voice', value: string) => {
    const v = value.trim();
    if (!v) return;
    await addMemo({ input, text: v });
    getQueue().wake();
    onSaved();
  };

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onDraft('');
    void save('text', v);
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await resizeImage(file, 1600);
      await addMemo({ input: 'photo', text: draft.trim(), photo });
      onDraft('');
      getQueue().wake();
      onSaved();
    } catch {
      notify('사진을 불러오지 못했어요');
    }
  };

  const beginListen = (e: React.PointerEvent<HTMLButtonElement>) => {
    const l = isSpeechSupported() ? startListening(setInterim) : null;
    if (!l) {
      notify('이 브라우저는 음성 입력을 지원하지 않아요');
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    listenRef.current = l;
    setInterim('');
    setListening(true);
  };

  const endListen = async () => {
    const l = listenRef.current;
    if (!l) return;
    listenRef.current = null;
    setListening(false);
    const result = await l.stop();
    setInterim('');
    // 마이크 권한을 거부하면 들린 말 없이 끝난다
    if (result) await save('voice', result);
    else notify('들린 말이 없어요. 마이크 권한을 확인해 주세요');
  };

  return (
    <>
      <div
        className="g-dim"
        data-no-pan
        data-testid="composer-dim"
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) onDismiss();
        }}
      />
      <div className="g-composer" data-no-pan data-testid="globe-composer">
        <div className="g-composer-field">
          <textarea
            ref={textRef}
            autoFocus
            value={draft}
            placeholder={focused ? '떠오르는 걸 바로 적어요' : ''}
            aria-label="메모 쓰기"
            data-testid="globe-composer-input"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') onDismiss();
            }}
          />
          {/* iOS는 제스처 없이 키보드를 못 띄우므로, 포커스 전에는 깜빡이는 가짜 커서 + 안내를 그린다 */}
          {!focused && !draft && (
            <span className="g-fake" aria-hidden>
              <i className="g-caret" />
              떠오르는 걸 바로 적어요
            </span>
          )}
          {listening && <div className="g-listen" data-testid="listen-sheet"><span className="rec-dot" />{interim || '듣고 있어요… 손을 떼면 저장돼요'}</div>}
        </div>
        <div className="g-composer-bar">
          <div className={`g-plus-wrap${plus ? ' open' : ''}`}>
            {plus && (
              <>
                <button
                  type="button"
                  className="g-choice"
                  data-testid="globe-voice"
                  onPointerDown={beginListen}
                  onPointerUp={() => void endListen()}
                  onPointerCancel={() => void endListen()}
                >
                  <MicIcon /> 녹음
                </button>
                <button type="button" className="g-choice" data-testid="globe-photo" onClick={() => fileRef.current?.click()}>
                  <CameraIcon /> 사진
                </button>
              </>
            )}
            <button type="button" className="g-plus" aria-label={plus ? '닫기' : '녹음·사진'} aria-expanded={plus} data-testid="globe-plus" onClick={() => setPlus(!plus)}>
              {plus ? '×' : '+'}
            </button>
          </div>
          <button type="button" className="g-send" aria-label="저장" data-testid="globe-send" disabled={!draft.trim()} onClick={submit}>
            <SendIcon />
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPickPhoto(e)} />
      </div>
    </>
  );
}
