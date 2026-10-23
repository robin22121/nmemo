import { useEffect, useState } from 'react';
import { LocalAnalyzer } from '../core/organize/local';
import { clearCredentials, dismissLogin, onLoginRequest, saveCredentials } from '../organize/auth';
import { connectAnalyzer, getQueue } from '../organize/runtime';

/**
 * 앱 안 로그인 칸(E8 종이 카드, 정가운데 작게): `/api/*`가 401이면 열린다.
 * 확인 → 기기에 저장하고 health를 다시 봐 새로 고침 없이 AI 정돈으로. 나중에 → 이번 실행은 기기 안 정돈, 다시 묻지 않음.
 */
export function LoginSheet() {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onLoginRequest(() => setOpen(true)), []);

  if (!open) return null;

  const submit = async () => {
    if (busy || !id || !pw) return;
    setBusy(true);
    setError('');
    saveCredentials(id, pw);
    try {
      const r = await connectAnalyzer();
      if (r === 'unauthorized') {
        clearCredentials();
        setError('아이디나 비밀번호가 맞지 않아요');
        return;
      }
      setPw('');
      setOpen(false);
    } catch {
      setError('지금은 확인하지 못했어요. 잠시 뒤 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    dismissLogin();
    getQueue().setAnalyzer(new LocalAnalyzer());
    setOpen(false);
  };

  return (
    <>
      <div className="login-back" />
      <form
        className="login-card"
        data-testid="login-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p id="login-title" className="login-title">AI 정돈을 쓰려면 로그인해 주세요</p>
        <p className="login-sub">로그인 정보는 이 기기에만 저장돼요. 로그인하지 않아도 메모는 기기 안에서 정리돼요.</p>
        <input
          className="login-input"
          data-testid="login-id"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="아이디"
          aria-label="아이디"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="login-input"
          data-testid="login-pw"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="비밀번호"
          aria-label="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {error && (
          <p className="login-error" data-testid="login-error" role="alert">
            {error}
          </p>
        )}
        <div className="login-acts">
          <button type="button" className="login-later" data-testid="login-later" onClick={later}>
            나중에
          </button>
          <button type="submit" className="login-ok" data-testid="login-submit" disabled={busy || !id || !pw}>
            {busy ? '확인 중…' : '확인'}
          </button>
        </div>
      </form>
    </>
  );
}
