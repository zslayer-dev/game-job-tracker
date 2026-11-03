import { useState } from 'react'
import { Link, Outlet } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { errorMessage, logError } from '../lib/errors'
import { supabase } from '../lib/supabase'

// 로그인한 화면 공통 틀: 상단 바(제목·계정·로그아웃) + 본문
export function AppLayout() {
  const { session } = useAuth()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    setPending(true)
    setFailed(false)
    // 이 브라우저의 세션만 끝낸다. 성공하면 RequireAuth가 로그인 화면으로 보낸다.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      logError('signOut', error)
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="brand">
          게임업계 구직 트래커
        </Link>
        <span className="account">{session?.user.email}</span>
        <button type="button" onClick={signOut} disabled={pending}>
          {pending ? '로그아웃 중…' : '로그아웃'}
        </button>
      </header>
      {failed && (
        <p className="error banner" role="alert">
          {errorMessage('INTERNAL')}
        </p>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  )
}
