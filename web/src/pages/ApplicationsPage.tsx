import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { errorMessage, logError } from '../lib/errors'
import { supabase } from '../lib/supabase'

// 지원 목록 화면. 목록·추가·필터는 M3·M4에서 채운다.
export function ApplicationsPage() {
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
        <strong>게임업계 구직 트래커</strong>
        <span className="account">{session?.user.email}</span>
        <button type="button" onClick={signOut} disabled={pending}>
          {pending ? '로그아웃 중…' : '로그아웃'}
        </button>
      </header>
      {failed && (
        <p className="error" role="alert">
          {errorMessage('INTERNAL')}
        </p>
      )}
      <main>
        <h1>지원 목록</h1>
        <p className="status">아직 지원 건이 없습니다.</p>
      </main>
    </div>
  )
}
