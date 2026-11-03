import { useState, type FormEvent } from 'react'
import {
  CHANNELS,
  MEMO_MAX,
  POSTING_TEXT_MAX,
  STATUSES,
  charCount,
  validate,
  type Application,
  type ApplicationInput,
  type Channel,
  type Status,
} from '../lib/applications'
import { errorMessage, type AppError } from '../lib/errors'

type Props = {
  initial?: Application
  submitLabel: string
  // 저장 결과의 오류를 돌려주면 폼이 문구로 보여준다
  onSubmit: (input: ApplicationInput) => Promise<AppError | null>
}

type FormState = {
  company: string
  position: string
  channel: Channel | ''
  status: Status
  applied_at: string
  deadline: string
  posting_text: string
  memo: string
}

function toFormState(app?: Application): FormState {
  return {
    company: app?.company ?? '',
    position: app?.position ?? '',
    channel: app?.channel ?? '',
    status: app?.status ?? '관심',
    applied_at: app?.applied_at ?? '',
    deadline: app?.deadline ?? '',
    posting_text: app?.posting_text ?? '',
    memo: app?.memo ?? '',
  }
}

// 빈 칸은 DB에 null로 저장한다
function toInput(form: FormState): ApplicationInput {
  return {
    company: form.company.trim(),
    position: form.position.trim(),
    channel: form.channel === '' ? null : form.channel,
    status: form.status,
    applied_at: form.applied_at === '' ? null : form.applied_at,
    deadline: form.deadline === '' ? null : form.deadline,
    posting_text: form.posting_text === '' ? null : form.posting_text,
    memo: form.memo === '' ? null : form.memo,
  }
}

function Counter({ value, max }: { value: string; max: number }) {
  const count = charCount(value)
  return (
    <span className={count > max ? 'counter over' : 'counter'}>
      {count.toLocaleString()} / {max.toLocaleString()}자
    </span>
  )
}

export function ApplicationForm({ initial, submitLabel, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [error, setError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = toInput(form)
    const invalid = validate(input)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    const result = await onSubmit(input)
    setSaving(false)
    setError(result)
  }

  return (
    <form className="app-form" onSubmit={handleSubmit} noValidate>
      <label>
        <span>
          회사명 <em className="required">필수</em>
        </span>
        <input value={form.company} onChange={(e) => set('company', e.target.value)} autoComplete="off" />
      </label>

      <label>
        <span>
          포지션·프로젝트 <em className="required">필수</em>
        </span>
        <input value={form.position} onChange={(e) => set('position', e.target.value)} autoComplete="off" />
      </label>

      <div className="row">
        <label>
          <span>상태</span>
          <select value={form.status} onChange={(e) => set('status', e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>지원 경로</span>
          <select value={form.channel} onChange={(e) => set('channel', e.target.value as Channel | '')}>
            <option value="">선택 안 함</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <label>
          <span>지원일</span>
          <input type="date" value={form.applied_at} onChange={(e) => set('applied_at', e.target.value)} />
        </label>

        <label>
          <span>마감일</span>
          <input type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </label>
      </div>

      <label>
        <span>
          공고 원문 <Counter value={form.posting_text} max={POSTING_TEXT_MAX} />
        </span>
        <textarea rows={10} value={form.posting_text} onChange={(e) => set('posting_text', e.target.value)} />
      </label>

      <label>
        <span>
          메모 <Counter value={form.memo} max={MEMO_MAX} />
        </span>
        <textarea rows={5} value={form.memo} onChange={(e) => set('memo', e.target.value)} />
      </label>

      {error && (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? '저장 중…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
