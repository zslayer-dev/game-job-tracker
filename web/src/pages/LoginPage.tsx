import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import type { LoginRedirectState } from '../auth/RequireAuth'
import { errorMessage, logError } from '../lib/errors'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const redirectState = location.state as LoginRedirectState | null
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(redirectState?.loginFailed ?? false)

  if (loading) return <p className="status">불러오는 중…</p>
  if (session) return <Navigate to="/" replace />

  async function signIn() {
    setPending(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // 지금 접속한 주소로 돌아온다 → 배포에서는 배포 주소, 로컬에서는 localhost:5173 (#9)
      options: {
        redirectTo: window.location.origin,
        // 로그아웃 후 다시 로그인할 때 이전 계정으로 바로 들어가지 않고 매번 계정 선택 화면을 띄운다.
        // 구글 계정 자체의 로그인 상태는 건드리지 않는다.
        queryParams: { prompt: 'select_account' },
      },
    })
    // 성공하면 구글로 이동하므로 여기 남는 건 실패한 경우뿐
    if (error) {
      logError('signInWithOAuth', error)
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <main className="login">
      <h1>게임업계 구직 트래커</h1>
      <p>여러 게임사 지원 현황을 한곳에서 관리하세요.</p>
      <button type="button" onClick={signIn} disabled={pending}>
        {pending ? '구글로 이동 중…' : '구글 계정으로 로그인'}
      </button>
      {failed && (
        <p className="error" role="alert">
          {errorMessage('LOGIN_FAILED')}
        </p>
      )}
      <p className="footnote">
        <a href="/privacy.html">개인정보처리방침</a>
      </p>
    </main>
  )
}
