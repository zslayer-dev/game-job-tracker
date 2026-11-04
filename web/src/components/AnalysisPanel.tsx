import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzePosting,
  getLatestAnalysis,
  getRemaining,
  saveAnalysis,
  type AnalysisResult,
  type Remaining,
  type SavedAnalysis,
} from '../lib/analysis'
import { errorMessage, type AppError } from '../lib/errors'

type Props = {
  applicationId: string
  // 화면의 공고 원문이 저장된 값과 다르면 true → 분석 버튼 비활성 (PRD 8장, #23)
  postingDirty: boolean
}

// AI 공고 분석 (PRD 5장 Should 6). 결과는 모두 텍스트 노드로만 그린다(HTML로 해석하지 않음).
export function AnalysisPanel({ applicationId, postingDirty }: Props) {
  const [latest, setLatest] = useState<SavedAnalysis | null>(null)
  const [remaining, setRemaining] = useState<Remaining | null>(null)
  const [loadError, setLoadError] = useState<AppError | null>(null)

  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [runError, setRunError] = useState<AppError | null>(null)

  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<AppError | null>(null)
  const [saved, setSaved] = useState(false)

  const refreshRemaining = useCallback(async () => {
    const r = await getRemaining()
    if (r.data) setRemaining(r.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([getLatestAnalysis(applicationId), getRemaining()]).then(([a, r]) => {
      if (cancelled) return
      setLatest(a.data)
      setRemaining(r.data)
      setLoadError(a.error ?? r.error)
    })
    return () => {
      cancelled = true
    }
  }, [applicationId])

  async function handleAnalyze() {
    // disabled가 그려지기 전 연속 클릭은 ref로 막는다
    if (runningRef.current || postingDirty) return
    runningRef.current = true
    setRunning(true)
    setRunError(null)
    setSaveError(null)
    setSaved(false)
    setResult(null)
    const r = await analyzePosting(applicationId)
    if (r.data) setResult(r.data)
    else setRunError(r.error)
    // 성공·실패 모두 서버 기록이 바뀌었을 수 있으므로 다시 읽는다
    await refreshRemaining()
    runningRef.current = false
    setRunning(false)
  }

  async function handleSave() {
    if (!result || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    const r = await saveAnalysis(applicationId, result)
    savingRef.current = false
    setSaving(false)
    if (r.error) {
      setSaveError(r.error)
      return
    }
    setLatest(r.data)
    setResult(null)
    setSaved(true)
  }

  const disabled = running || postingDirty

  return (
    <section className="analysis" aria-labelledby="analysis-title">
      <div className="analysis-head">
        <h2 id="analysis-title">AI 공고 분석</h2>
        {remaining && (
          <span className="remaining" aria-live="polite">
            오늘 남은 분석 {remaining.remaining} / {remaining.daily_limit}회
          </span>
        )}
      </div>
      <p className="footnote">저장된 공고 원문과 내 경력 프로필을 비교합니다. 분석 결과는 [결과 저장]을 눌러야 남습니다.</p>

      <div className="actions">
        <button type="button" className="primary" onClick={handleAnalyze} disabled={disabled}>
          {running ? '분석 중…' : 'AI 분석'}
        </button>
      </div>
      {postingDirty && (
        <p className="hint" role="status">
          공고 원문을 고쳤습니다. 분석하려면 먼저 저장해 주세요.
        </p>
      )}
      {running && (
        <p className="status" role="status">
          분석하고 있습니다. 최대 1분쯤 걸릴 수 있습니다.
        </p>
      )}
      {loadError && (
        <p className="error" role="alert">
          {errorMessage(loadError)}
        </p>
      )}
      {runError && (
        <p className="error" role="alert">
          {errorMessage(runError)}
        </p>
      )}

      {result && (
        <div className="analysis-result new" data-testid="analysis-new">
          <h3>새 분석 결과 (저장 전)</h3>
          <AnalysisView value={result} />
          <div className="actions">
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중…' : '결과 저장'}
            </button>
          </div>
          {saveError && (
            <p className="error" role="alert">
              {errorMessage(saveError)}
            </p>
          )}
        </div>
      )}

      {saved && (
        <p className="success" role="status">
          분석 결과를 저장했습니다.
        </p>
      )}

      {latest && (
        <div className="analysis-result" data-testid="analysis-saved">
          <h3>
            저장된 분석 <span className="muted">({new Date(latest.created_at).toLocaleString('ko-KR')})</span>
          </h3>
          <AnalysisView value={latest} />
        </div>
      )}
    </section>
  )
}

function SkillList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="skill-list">
      <span className="label">{label}</span>
      {items.length === 0 ? (
        <span className="muted">없음</span>
      ) : (
        <ul className="tags">
          {items.map((s) => (
            <li key={s} className="tag plain">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AnalysisView({ value }: { value: AnalysisResult }) {
  return (
    <div className="analysis-view">
      <p className="score">
        적합도 <strong>{value.fit_score}</strong> / 100
      </p>
      <SkillList label="매칭 기술" items={value.matched_skills} />
      <SkillList label="부족 기술" items={value.missing_skills} />
      <p className="comment">{value.comment}</p>
    </div>
  )
}
