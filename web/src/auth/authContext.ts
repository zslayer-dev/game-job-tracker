import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AuthState = {
  session: Session | null
  // 첫 세션 확인(구글 로그인 후 code 교환 포함)이 끝나기 전에는 true
  loading: boolean
}

export const AuthContext = createContext<AuthState>({ session: null, loading: true })
