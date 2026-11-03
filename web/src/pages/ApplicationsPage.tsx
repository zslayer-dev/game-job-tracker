import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { STATUSES, listApplications, parseStatus, type ApplicationListItem, type Status } from '../lib/applications'
import { errorMessage, type AppError } from '../lib/errors'
import type { ListLinkState } from '../lib/listLocation'
import { SEARCH_MAX } from '../lib/search'

const SEARCH_DELAY_MS = 300

// 지원 목록. 필터·검색어는 URL(?status=&q=)에 담아 새로고침·뒤로가기에도 유지한다.
export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const status = parseStatus(searchParams.get('status'))
  const q = (searchParams.get('q') ?? '').slice(0, SEARCH_MAX)

  // 검색 입력칸은 타이핑 중인 값. 멈춘 뒤에 URL(q)로 옮긴다.
  const [draft, setDraft] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  if (q !== syncedQ) {
    // 뒤로가기 등으로 URL의 q가 바뀌면 입력칸도 맞춘다
    setSyncedQ(q)
    setDraft(q)
  }

  // 결과가 어떤 조건(key)으로 불러온 것인지 함께 둔다. 조건이 바뀌면 새 결과가 올 때까지 "불러오는 중".
  const key = `${status ?? ''}|${q}`
  const [result, setResult] = useState<{ key: string; items: ApplicationListItem[] | null; error: AppError | null } | null>(null)
  const loading = result?.key !== key
  const items = result?.items ?? null
  const error = result?.error ?? null

  const updateParams = useCallback(
    (next: { status?: Status | null; q?: string }, replace: boolean) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next.status !== undefined) {
            if (next.status) params.set('status', next.status)
            else params.delete('status')
          }
          if (next.q !== undefined) {
            if (next.q) params.set('q', next.q)
            else params.delete('q')
          }
          return params
        },
        { replace },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    const value = draft.trim()
    if (value === q.trim()) return
    const timer = setTimeout(() => updateParams({ q: value }, true), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft, q, updateParams])

  useEffect(() => {
    let cancelled = false
    listApplications({ status, q }).then((r) => {
      if (!cancelled) setResult({ key: `${status ?? ''}|${q}`, items: r.data, error: r.error })
    })
    return () => {
      cancelled = true
    }
  }, [status, q])

  const filtered = status !== null || q.trim() !== ''
  const listState: ListLinkState = { listSearch: searchParams.toString() }

  function clearFilters() {
    setDraft('')
    updateParams({ status: null, q: '' }, false)
  }

  return (
    <>
      <div className="page-head">
        <h1>지원 목록</h1>
        <Link to="/applications/new" state={listState} className="button primary">
          지원 건 추가
        </Link>
      </div>

      <div className="filters" role="search">
        <label>
          <span>상태</span>
          <select value={status ?? ''} onChange={(e) => updateParams({ status: parseStatus(e.target.value) }, false)}>
            <option value="">전체</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span>회사명 검색</span>
          <input
            type="search"
            value={draft}
            maxLength={SEARCH_MAX}
            placeholder="회사명"
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        {filtered && (
          <button type="button" onClick={clearFilters}>
            조건 초기화
          </button>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      )}

      {!error && items === null && <p className="status">불러오는 중…</p>}

      {!error && items?.length === 0 && !loading && (
        <div className="empty">
          {filtered ? (
            <>
              <p>조건에 맞는 지원 건이 없습니다.</p>
              <button type="button" onClick={clearFilters}>
                조건 초기화
              </button>
            </>
          ) : (
            <>
              <p>첫 지원 건을 추가해 보세요.</p>
              <Link to="/applications/new" className="button primary">
                지원 건 추가
              </Link>
            </>
          )}
        </div>
      )}

      {!error && items && items.length > 0 && (
        <div className={loading ? 'table-wrap stale' : 'table-wrap'} aria-busy={loading}>
          <table className="list">
            <thead>
              <tr>
                <th>회사</th>
                <th>포지션</th>
                <th>상태</th>
                <th>지원일</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {items.map((app) => (
                <tr key={app.id}>
                  <td>
                    <Link to={`/applications/${app.id}`} state={listState}>
                      {app.company}
                    </Link>
                  </td>
                  <td>{app.position}</td>
                  <td>
                    <span className="badge">{app.status}</span>
                  </td>
                  <td>{app.applied_at ?? '—'}</td>
                  <td>{app.deadline ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
