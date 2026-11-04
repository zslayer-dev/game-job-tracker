import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AuthState = {
  session: Session | null
  // 첫 세션 확인(구글 로그인 후 code 교환 포함)이 끝나기 전에는 true
  loading: boolean
  // 사용자가 누르지 않았는데 세션이 끝난 경우(토큰 만료·거부) true → 로그인 화면에서 안내
  expired: boolean
}

export type AuthContextValue = AuthState & {
  // 사용자가 직접 로그아웃할 때 쓴다. 실패하면 false.
  signOut: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  expired: false,
  signOut: async () => false,
})
