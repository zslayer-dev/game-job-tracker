import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Counter } from '../components/ApplicationForm'
import { TagInput } from '../components/TagInput'
import { errorMessage, type AppError } from '../lib/errors'
import {
  PROFILE_TEXT_MAX,
  TAG_LEN_MAX,
  TAGS_MAX,
  getMyProfile,
  saveMyProfile,
  validateProfile,
  type Profile,
  type ProfileInput,
} from '../lib/profiles'

type FormState = { summary: string; engines: string[]; skills: string[]; strengths: string; gaps: string }

function toFormState(p: Profile | null): FormState {
  return {
    summary: p?.summary ?? '',
    engines: p?.engines ?? [],
    skills: p?.skills ?? [],
    strengths: p?.strengths ?? '',
    gaps: p?.gaps ?? '',
  }
}

// 빈 칸은 DB에 null로 저장한다
function toInput(f: FormState): ProfileInput {
  const text = (v: string) => (v.trim() === '' ? null : v)
  return { summary: text(f.summary), engines: f.engines, skills: f.skills, strengths: text(f.strengths), gaps: text(f.gaps) }
}

// 내 경력 프로필 (AI 공고 분석의 기준 데이터, PRD 5장 Should 5)
export function ProfilePage() {
  const [form, setForm] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<AppError | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    getMyProfile().then((result) => {
      if (cancelled) return
      setLoadError(result.error)
      if (!result.error) setForm(toFormState(result.data))
    })
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setSaved(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // disabled가 그려지기 전 연속 제출은 ref로 막는다
    if (!form || savingRef.current) return
    const input = toInput(form)
    const invalid = validateProfile(input)
    if (invalid) {
      setError(invalid)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    setSaved(false)
    const result = await saveMyProfile(input)
    savingRef.current = false
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setForm(toFormState(result.data))
    setSaved(true)
  }

  return (
    <>
      <div className="page-head">
        <h1>내 프로필</h1>
      </div>
      <p className="footnote">AI 공고 분석에서 공고와 비교하는 기준이 됩니다. 나만 볼 수 있습니다.</p>

      {loadError && (
        <p className="error" role="alert">
          {errorMessage(loadError)}
        </p>
      )}
      {!loadError && !form && <p className="status">불러오는 중…</p>}

      {form && (
        <form className="app-form" onSubmit={handleSubmit} noValidate>
          <label>
            <span>
              경력 요약 <Counter value={form.summary} max={PROFILE_TEXT_MAX} />
            </span>
            <textarea rows={5} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
          </label>

          <TagInput
            label="주력 엔진"
            tags={form.engines}
            max={TAGS_MAX}
            maxLength={TAG_LEN_MAX}
            placeholder="예: Unity"
            onChange={(v) => set('engines', v)}
          />

          <TagInput
            label="기술 스택"
            tags={form.skills}
            max={TAGS_MAX}
            maxLength={TAG_LEN_MAX}
            placeholder="예: C#"
            onChange={(v) => set('skills', v)}
          />

          <label>
            <span>
              강점 <Counter value={form.strengths} max={PROFILE_TEXT_MAX} />
            </span>
            <textarea rows={4} value={form.strengths} onChange={(e) => set('strengths', e.target.value)} />
          </label>

          <label>
            <span>
              보완점 <Counter value={form.gaps} max={PROFILE_TEXT_MAX} />
            </span>
            <textarea rows={4} value={form.gaps} onChange={(e) => set('gaps', e.target.value)} />
          </label>

          {error && (
            <p className="error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          {saved && (
            <p className="success" role="status">
              저장했습니다.
            </p>
          )}

          <div className="actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      )}
    </>
  )
}
