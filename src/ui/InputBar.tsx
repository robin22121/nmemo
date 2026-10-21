import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addMemo } from '../db/repo';
import { CameraIcon, MicIcon, PenIcon, SendIcon } from './icons';
import { resizeImage } from './image';
import { isSpeechSupported, startListening, type Listening } from './speech';

interface Props {
  notify: (message: string) => void;
  /** 저장 직후 호출(대기열 깨우기 등) */
  onSaved?: () => void;
}

export function InputBar({ notify, onSaved }: Props) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listenRef = useRef<Listening | null>(null);

  useEffect(() => {
    if (composing) textRef.current?.focus();
  }, [composing]);

  const save = useCallback(
    async (input: 'text' | 'voice', value: string, id?: string) => {
      const v = value.trim();
      if (!v) return;
      await addMemo({ id, input, text: v });
      onSaved?.();
    },
    [onSaved],
  );

  const submitText = async () => {
    const v = text.trim();
    if (!v) return;
    const id = draftId;
    setText('');
    setComposing(false);
    setDraftId(crypto.randomUUID());
    await save('text', v, id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitText();
    } else if (e.key === 'Escape') {
      setComposing(false);
    }
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await resizeImage(file, 1600);
      await addMemo({ input: 'photo', text: '', photo });
      onSaved?.();
    } catch {
      notify('사진을 불러오지 못했어요');
    }
  };

  const beginListen = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isSpeechSupported()) {
      notify('이 브라우저는 음성 입력을 지원하지 않아요');
      setComposing(true);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const l = startListening(setInterim);
    if (!l) {
      notify('이 브라우저는 음성 입력을 지원하지 않아요');
      setComposing(true);
      return;
    }
    listenRef.current = l;
    setComposing(false);
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
    if (result) await save('voice', result);
    else notify('들린 말이 없어요');
  };

  return (
    <div className="inputbar-wrap">
      <AnimatePresence>
        {listening && (
          <motion.div
            key="listen"
            className="listen-sheet"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            data-testid="listen-sheet"
          >
            <span className="rec-dot" />
            {interim || '듣고 있어요… 손을 떼면 저장돼요'}
          </motion.div>
        )}
        {composing && (
          <motion.div
            key="composer"
            className="composer"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <motion.div layoutId={`memo-${draftId}`} className="draft-preview" aria-hidden>
              {text.trim() || '…'}
            </motion.div>
            <textarea
              ref={textRef}
              data-testid="composer-input"
              value={text}
              rows={1}
              placeholder="떠오르는 걸 적어보세요"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="메모 쓰기"
            />
            <button
              type="button"
              className="send-btn"
              data-testid="composer-send"
              onClick={() => void submitText()}
              disabled={!text.trim()}
              aria-label="저장"
            >
              <SendIcon />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="inputbar" role="toolbar" aria-label="메모 입력">
        <button
          type="button"
          className={`ib-btn${composing ? ' active' : ''}`}
          data-testid="btn-write"
          onClick={() => setComposing((v) => !v)}
        >
          <PenIcon />
          <span>쓰기</span>
        </button>
        <button
          type="button"
          className={`ib-btn mic${listening ? ' active' : ''}`}
          data-testid="btn-voice"
          onPointerDown={beginListen}
          onPointerUp={() => void endListen()}
          onPointerCancel={() => void endListen()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MicIcon />
          <span>녹음</span>
        </button>
        <button type="button" className="ib-btn" data-testid="btn-photo" onClick={() => fileRef.current?.click()}>
          <CameraIcon />
          <span>사진</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          data-testid="photo-input"
          onChange={(e) => void onPickPhoto(e)}
        />
      </div>
    </div>
  );
}
