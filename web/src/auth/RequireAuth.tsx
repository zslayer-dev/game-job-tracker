import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'

export type LoginRedirectState = { loginFailed?: boolean }

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p className="status">불러오는 중…</p>

  if (!session) {
    // 구글 로그인이 실패하면 ?error=... 로 돌아온다. 원본 사유는 보여주지 않고 실패 여부만 넘긴다.
    const state: LoginRedirectState = { loginFailed: new URLSearchParams(location.search).has('error') }
    return <Navigate to="/login" replace state={state} />
  }

  return <Outlet />
}
