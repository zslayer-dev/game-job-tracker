// 운영 전용 함수 public.rls_auto_enable()의 실행 권한 회수 마이그레이션 검증 (#20 대응)
// 로컬에는 이 함수가 없으므로, 트랜잭션 안에서 운영과 같은 모양의 가짜 함수를 만들고 마이그레이션 SQL을 실행한 뒤 되돌린다.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { withDb } from './helpers/local.mjs'

const dir = new URL('../supabase/migrations/', import.meta.url)
const file = readdirSync(dir).find((f) => f.endsWith('_revoke_rls_auto_enable.sql'))
const migrationSql = readFileSync(new URL(file, dir), 'utf8')

async function inRollback(fn) {
  return withDb(async (db) => {
    await db.query('begin')
    try {
      return await fn(db)
    } finally {
      await db.query('rollback')
    }
  })
}

async function canExecute(db, role) {
  const { rows } = await db.query(`select has_function_privilege($1, 'public.rls_auto_enable()', 'execute') as ok`, [role])
  return rows[0].ok
}

describe('rls_auto_enable() 실행 권한 회수', () => {
  test('함수가 없으면(로컬) 아무 일 없이 통과', async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(`select to_regprocedure('public.rls_auto_enable()') as fn`)
      assert.equal(rows[0].fn, null)
      await db.query(migrationSql)
    })
  })

  test('함수가 있으면(운영) anon·authenticated가 실행할 수 없게 된다', async () => {
    await inRollback(async (db) => {
      // 운영과 같은 조건: SECURITY DEFINER + 기본 PUBLIC 실행 권한 + anon·authenticated 명시 권한
      await db.query(`
        create function public.rls_auto_enable() returns event_trigger
        language plpgsql security definer set search_path = '' as $$ begin end; $$;
        grant execute on function public.rls_auto_enable() to public, anon, authenticated;
      `)
      assert.equal(await canExecute(db, 'anon'), true, '준비: 회수 전에는 실행 가능해야 한다')
      assert.equal(await canExecute(db, 'authenticated'), true)

      await db.query(migrationSql)

      assert.equal(await canExecute(db, 'anon'), false)
      assert.equal(await canExecute(db, 'authenticated'), false)
      // 소유자(postgres)는 그대로 실행 가능 → 이벤트 트리거 동작에 영향 없음
      assert.equal(await canExecute(db, 'postgres'), true)
    })
  })

  test('실제 로컬 DB에는 가짜 함수가 남지 않았다', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(`select to_regprocedure('public.rls_auto_enable()') as fn`)
      assert.equal(rows[0].fn, null)
    })
  })
})
