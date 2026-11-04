import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AUTH_REQUIRED_EVENT, authEvents } from '../lib/authEvents'
import { logError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthState } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, expired: false })
  // 사용자가 로그아웃 버튼을 눌러 끝낸 세션인지 구분한다
  const userSignOut = useRef(false)

  useEffect(() => {
    // INITIAL_SESSION은 URL의 로그인 code 교환까지 끝난 뒤에 온다
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const expiredNow = event === 'SIGNED_OUT' && !userSignOut.current
      if (event === 'SIGNED_OUT') userSignOut.current = false
      setState((prev) => ({
        session,
        loading: false,
        expired: event === 'SIGNED_OUT' ? expiredNow : event === 'SIGNED_IN' ? false : prev.expired,
      }))
    })

    // API가 토큰 만료·거부를 알려 오면 이 브라우저의 세션을 정리한다 → SIGNED_OUT → 로그인 화면
    function onAuthRequired() {
      supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
        if (error) logError('signOut after AUTH_REQUIRED', error)
      })
    }
    authEvents.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)

    return () => {
      subscription.unsubscribe()
      authEvents.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    }
  }, [])

  const signOut = useCallback(async () => {
    userSignOut.current = true
    // 이 브라우저의 세션만 끝낸다(구글 계정 로그인 상태는 그대로)
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      userSignOut.current = false
      logError('signOut', error)
      return false
    }
    return true
  }, [])

  const value = useMemo(() => ({ ...state, signOut }), [state, signOut])

  return <AuthContext value={value}>{children}</AuthContext>
}
