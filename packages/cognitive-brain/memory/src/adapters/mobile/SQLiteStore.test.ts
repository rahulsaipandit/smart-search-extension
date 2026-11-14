import { open } from '@op-engineering/op-sqlite'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { SQLiteStore } from './SQLiteStore'

vi.mock('@op-engineering/op-sqlite', () => ({ open: vi.fn() }))

function makeFakeDb(executeImpl: (sql: string) => Promise<unknown>) {
	return {
		execute: vi.fn(executeImpl),
		close: vi.fn(),
	}
}

describe('SQLiteStore.addColumnIfMissing (migration error handling)', () => {
	afterEach(() => vi.clearAllMocks())

	test('swallows the expected "duplicate column name" error and completes initialize()', async () => {
		const db = makeFakeDb(async (sql: string) => {
			if (sql.includes('ADD COLUMN')) throw new Error('duplicate column name: is_durable')
			return { rows: [] }
		})
		;(open as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db)

		const store = new SQLiteStore(':memory-test:')
		await expect(store.initialize()).resolves.toBeUndefined()
	})

	test('does not swallow an unrelated migration failure - initialize() rejects', async () => {
		const db = makeFakeDb(async (sql: string) => {
			if (sql.includes('ADD COLUMN')) throw new Error('disk I/O error')
			return { rows: [] }
		})
		;(open as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db)

		const store = new SQLiteStore(':memory-test-2:')
		await expect(store.initialize()).rejects.toThrow('disk I/O error')
	})
})
