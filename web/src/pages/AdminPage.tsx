import { useEffect, useRef, useState } from 'react'
import { getAccessMode, listUsers, resetQuota, setAccessMode, setAllowed, type AccessMode, type AdminUser } from '../lib/admin'
import { errorMessage, type AppError } from '../lib/errors'

const MODE_LABEL: Record<AccessMode, string> = { all: '전체 허용', allowlist: '허용 목록만' }

const EMPTY_ALLOWLIST_WARNING =
  "허용 목록이 비어 있습니다.\n'허용 목록만'으로 바꾸면 관리자를 포함한 모든 사용자가 AI 분석을 쓸 수 없습니다.\n그래도 바꿀까요?"

function formatDate(value: string | null, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  return withTime ? d.toLocaleString('ko-KR') : d.toLocaleDateString('ko-KR')
}

// 관리자 페이지 (PRD 5장 Could 7). 관리자가 아니면 DB가 FORBIDDEN을 돌려주고, 화면은 안내만 보인다.
// 모든 값은 텍스트로만 그린다.
export function AdminPage() {
  const [mode, setMode] = useState<AccessMode | null>(null)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loadError, setLoadError] = useState<AppError | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [actionError, setActionError] = useState<AppError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listUsers(), getAccessMode()]).then(([u, m]) => {
      if (cancelled) return
      setLoadError(u.error ?? m.error)
      setUsers(u.data)
      setMode(m.data)
    })
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  // 쓰기 동작 공통: 연타 방지(ref), 오류·완료 문구, 끝나면 목록 다시 읽기
  async function run(action: () => Promise<{ error: AppError | null }>, done: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setActionError(null)
    setNotice(null)
    const { error } = await action()
    busyRef.current = false
    setBusy(false)
    if (error) {
      setActionError(error)
      return
    }
    setNotice(done)
    setReloadCount((n) => n + 1)
  }

  function changeMode(next: AccessMode) {
    if (!users || next === mode) return
    if (next === 'allowlist' && !users.some((u) => u.ai_allowlisted) && !window.confirm(EMPTY_ALLOWLIST_WARNING)) return
    run(() => setAccessMode(next), `AI 분석 권한을 '${MODE_LABEL[next]}'으로 바꿨습니다.`)
  }

  function toggleAllowed(user: AdminUser) {
    const next = !user.ai_allowlisted
    run(() => setAllowed(user.user_id, next), next ? `${user.email}을 허용 목록에 넣었습니다.` : `${user.email}을 허용 목록에서 뺐습니다.`)
  }

  function reset(user: AdminUser) {
    if (!window.confirm(`${user.email}의 오늘 AI 사용 횟수를 초기화할까요?\n호출 기록은 지워지지 않고, 서비스 전체 사용 횟수는 그대로입니다.`)) return
    run(() => resetQuota(user.user_id), `${user.email}의 오늘 사용 횟수를 초기화했습니다.`)
  }

  const allowlistCount = users?.filter((u) => u.ai_allowlisted).length ?? 0

  return (
    // admin-page: 열이 많아 넓은 화면에서는 본문 폭을 넓힌다(index.css)
    <div className="admin-page">
      <div className="page-head">
        <h1>관리자</h1>
      </div>

      {loadError && (
        <p className="error" role="alert">
          {errorMessage(loadError)}
        </p>
      )}
      {!loadError && (users === null || mode === null) && <p className="status">불러오는 중…</p>}

      {!loadError && users && mode && (
        <>
          <section className="admin-section" aria-labelledby="mode-title">
            <h2 id="mode-title">AI 분석 권한</h2>
            <div className="segmented" role="group" aria-label="AI 분석 권한 모드">
              {(['all', 'allowlist'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} disabled={busy} onClick={() => changeMode(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="footnote">
              {mode === 'all'
                ? '모든 사용자가 AI 분석을 쓸 수 있습니다. 허용 목록은 "허용 목록만"으로 바꿨을 때 적용됩니다.'
                : '허용 목록에 있는 사용자만 AI 분석을 쓸 수 있습니다. 관리자도 목록에 있어야 합니다.'}{' '}
              허용 목록 {allowlistCount}명.
            </p>
          </section>

          {actionError && (
            <p className="error" role="alert">
              {errorMessage(actionError)}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}

          <section className="admin-section" aria-labelledby="users-title">
            <h2 id="users-title">사용자 {users.length}명</h2>
            <div className="table-scroll">
              <table className="admin-users">
                <thead>
                  <tr>
                    <th>이메일</th>
                    <th>가입일</th>
                    <th>마지막 로그인</th>
                    <th>지원 건</th>
                    <th>오늘 AI</th>
                    <th>AI 허용</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} data-email={u.email}>
                      <td className="email">{u.email}</td>
                      <td>{formatDate(u.created_at)}</td>
                      <td>{formatDate(u.last_sign_in_at, true)}</td>
                      <td className="num">{u.application_count}</td>
                      <td className="num">
                        {u.ai_used_today} / {u.ai_daily_limit}
                      </td>
                      <td>
                        <span className={u.ai_allowed ? 'badge' : 'badge off'}>{u.ai_allowed ? '허용' : '차단'}</span>
                        {u.ai_allowlisted && <span className="muted"> 목록</span>}
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button type="button" disabled={busy} onClick={() => toggleAllowed(u)}>
                            {u.ai_allowlisted ? '목록에서 빼기' : '목록에 넣기'}
                          </button>
                          <button type="button" disabled={busy} onClick={() => reset(u)}>
                            횟수 초기화
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
