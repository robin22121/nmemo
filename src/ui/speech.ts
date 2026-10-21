/** Web Speech API 얇은 래퍼. 지원하지 않는 브라우저에서는 isSpeechSupported()가 false. */

interface RecognitionResultItem { transcript: string }
interface RecognitionResult { isFinal: boolean; 0: RecognitionResultItem }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && getCtor() !== null;
}

export interface Listening {
  /** 떼면 호출. 받아적은 최종 글을 돌려준다. */
  stop(): Promise<string>;
  abort(): void;
}

export function startListening(onInterim: (text: string) => void): Listening | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let interim = '';
  let ended = false;
  let resolveStop: ((t: string) => void) | null = null;

  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim((finalText + interim).trim());
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    resolveStop?.((finalText + interim).trim());
  };
  rec.onend = finish;
  rec.onerror = finish;
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () =>
      new Promise<string>((resolve) => {
        if (ended) return resolve((finalText + interim).trim());
        resolveStop = resolve;
        try { rec.stop(); } catch { finish(); }
        setTimeout(finish, 1500);
      }),
    abort: () => {
      ended = true;
      try { rec.abort(); } catch { /* noop */ }
    },
  };
}
