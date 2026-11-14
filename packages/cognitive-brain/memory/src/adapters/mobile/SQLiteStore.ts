/**
 * SQLiteStore - mobile adapter for IMemoryStore
 *
 * Uses @op-engineering/op-sqlite for persistent storage on React Native / Expo.
 * Ported from GA's production MemoryStore.native.ts with CB interface adaptations:
 *   - putRelation accepts { sourceId, ...relation } (flat object, not (id, relation))
 *   - delete supports soft-delete (purge = false) vs. hard-delete (purge = true)
 *   - MemoryFilter supports lifecycleState and ids predicates
 *   - MemoryEntry columns extended: lifecycle_state, retention_policy, retrieval_count,
 *     compression_level, synthesis_quality, synthesized_at, linked_procedure_ids
 *   - close() releases the DB connection
 */
import { type DB, open } from '@op-engineering/op-sqlite'

import {
	GAP_TAG_QUERY_SLOW_MS,
	gapMetric,
	gapMetricsEnabled,
	nowMs,
} from '../../core/metrics/gapMetrics'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry, MemoryFilter, MemoryRelation } from '../../types'

const DB_NAME = 'cb_memory.db'

export class SQLiteStore implements IMemoryStore {
	private db: DB | null = null
	private initialized = false

	constructor(private dbName: string = DB_NAME) {}

	// ── Lifecycle ────────────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.initialized) return

		try {
			this.db = open({ name: this.dbName })
			// WAL lets concurrent readers/writers coexist instead of failing immediately with
			// "database is locked"; busy_timeout retries for a bit before giving up on top of that.
			await this.db.execute('PRAGMA journal_mode = WAL')
			await this.db.execute('PRAGMA busy_timeout = 5000')
			await this.createTables()
			this.initialized = true
			console.log('[SQLiteStore] Initialized SQLite successfully')
		} catch (error) {
			console.error('[SQLiteStore] Initialization failed:', error)
			throw error
		}
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db.close()
			this.db = null
			this.initialized = false
		}
	}

	private async createTables(): Promise<void> {
		if (!this.db) throw new Error('Database not open')

		// ── memories ─────────────────────────────────────────────────────────────
		await this.db.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id                  TEXT PRIMARY KEY,
        type                TEXT NOT NULL,
        title               TEXT,
        content             TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT,
        tags                TEXT,
        entities            TEXT,
        importance          INTEGER,
        confidence          REAL,
        salience            REAL,
        outcome             TEXT,
        source_ids          TEXT,
        relations           TEXT,
        user_id             TEXT,
        agent_id            TEXT,
        session_id          TEXT,
        metadata            TEXT,
        lifecycle_state     TEXT DEFAULT 'active',
        retention_policy    TEXT,
        retrieval_count     INTEGER DEFAULT 0,
        compression_level   INTEGER DEFAULT 0,
        synthesis_quality   TEXT,
        synthesized_at      TEXT,
        linked_procedure_ids TEXT,
        is_durable          INTEGER,
        expires_at          TEXT
      )
    `)

		// §16.1 (designCognitiveBrain.md) - added post-launch; ALTER is a no-op if
		// the table was just created above with the columns already present.
		await this.addColumnIfMissing('memories', 'is_durable', 'INTEGER')
		await this.addColumnIfMissing('memories', 'expires_at', 'TEXT')

		// Indexes
		await this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_type       ON memories(type)')
		await this.db.execute('CREATE INDEX IF NOT EXISTS idx_memories_user       ON memories(user_id)')
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_memories_agent      ON memories(agent_id)'
		)
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_memories_session    ON memories(session_id)'
		)
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_memories_created    ON memories(created_at)'
		)
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)'
		)
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_memories_lifecycle  ON memories(lifecycle_state)'
		)

		// ── memory_relations ──────────────────────────────────────────────────────
		await this.db.execute(`
      CREATE TABLE IF NOT EXISTS memory_relations (
        id            TEXT PRIMARY KEY,
        from_id       TEXT NOT NULL,
        to_id         TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight        REAL,
        metadata      TEXT,
        created_at    TEXT NOT NULL
      )
    `)

		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id)'
		)
		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_relations_to   ON memory_relations(to_id)'
		)

		// The old pipeline_retries table was never written to; a failed job is retried in memory by Pipeline (designKnownGaps.md, section 10, gap 11).
		await this.db.execute('DROP TABLE IF EXISTS pipeline_retries')

		// ── pruning_state ─────────────────────────────────────────────────────────
		await this.db.execute(`
      CREATE TABLE IF NOT EXISTS pruning_state (
        id                        INTEGER PRIMARY KEY,
        last_daily_summary_date   TEXT,
        last_weekly_summary_date  TEXT,
        last_monthly_summary_date TEXT
      )
    `)

		// ── working_memory ────────────────────────────────────────────────────────
		await this.db.execute(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entry_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )
    `)

		await this.db.execute(
			'CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id)'
		)
	}

	/**
	 * Add a column to an existing table if it doesn't already exist. SQLite has
	 * no `ADD COLUMN IF NOT EXISTS`; the safe portable approach is to attempt
	 * the ALTER and swallow the "duplicate column" failure it throws when the
	 * column is already there (e.g. on an app upgrade from before this field existed).
	 */
	private async addColumnIfMissing(table: string, column: string, sqlType: string): Promise<void> {
		if (!this.db) return
		try {
			await this.db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			// Only swallow the expected "already migrated" case. Anything else
			// (locked DB, disk full, corrupted schema) must surface loudly here -
			// silently continuing would leave the column missing while put()'s
			// INSERT still references it, turning a diagnosable migration failure
			// into every subsequent write failing with an unrelated-looking error.
			if (!/duplicate column name/i.test(message)) {
				console.error(`[SQLiteStore] Failed to add column '${column}' to '${table}':`, message)
				throw error
			}
		}
	}

	// ── CRUD ─────────────────────────────────────────────────────────────────────

	async put(entry: MemoryEntry): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute(
			`INSERT OR REPLACE INTO memories
       (id, type, title, content, created_at, updated_at,
        tags, entities, importance, confidence, salience, outcome,
        source_ids, relations, user_id, agent_id, session_id, metadata,
        lifecycle_state, retention_policy, retrieval_count, compression_level,
        synthesis_quality, synthesized_at, linked_procedure_ids,
        is_durable, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.type,
				entry.title ?? null,
				entry.content,
				entry.createdAt,
				entry.updatedAt ?? null,
				JSON.stringify(entry.tags ?? []),
				JSON.stringify(entry.entities ?? []),
				entry.importance ?? null,
				entry.confidence ?? null,
				entry.salience ?? null,
				entry.outcome ?? null,
				JSON.stringify(entry.sourceIds ?? []),
				JSON.stringify(entry.relations ?? []),
				entry.userId ?? null,
				entry.agentId ?? null,
				entry.sessionId ?? null,
				JSON.stringify(entry.metadata ?? {}),
				entry.lifecycleState ?? 'active',
				entry.retentionPolicy ?? null,
				entry.retrievalCount ?? 0,
				entry.compressionLevel ?? 0,
				entry.synthesisQuality ?? null,
				entry.synthesizedAt ?? null,
				JSON.stringify(entry.linkedProcedureIds ?? []),
				entry.isDurable === undefined ? null : entry.isDurable ? 1 : 0,
				entry.expiresAt ?? null,
			]
		)
	}

	async get(id: string): Promise<MemoryEntry | null> {
		if (!this.db) throw new Error('Store not initialized')

		const result = await this.db.execute('SELECT * FROM memories WHERE id = ?', [id])

		if (!result.rows || result.rows.length === 0) return null

		return this.mapRowToEntry(result.rows[0])
	}

	/**
	 * Soft-delete (default): sets lifecycle_state = 'deleted'.
	 * Hard-delete (purge = true): removes the row entirely.
	 */
	async delete(id: string, purge = false): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		if (purge) {
			await this.db.execute('DELETE FROM memories WHERE id = ?', [id])
		} else {
			await this.db.execute(
				`UPDATE memories SET lifecycle_state = 'deleted', updated_at = ? WHERE id = ?`,
				[new Date().toISOString(), id]
			)
		}
	}

	async putMany(entries: MemoryEntry[]): Promise<void> {
		for (const entry of entries) {
			await this.put(entry)
		}
	}

	async deleteMany(ids: string[]): Promise<void> {
		for (const id of ids) {
			// Hard-delete for bulk operations
			await this.delete(id, true)
		}
	}

	async query(
		filter: MemoryFilter,
		limit = 100,
		cursor?: string
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }> {
		if (!this.db) throw new Error('Store not initialized')

		const { whereClause, params } = this.buildWhereClause(filter, cursor)

		const sql = `
      SELECT * FROM memories
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `

		const startedAt = nowMs()
		const result = await this.db.execute(sql, [...params, limit + 1])
		const rows = (result.rows ?? []) as any[]
		const entries = rows.map((row) => this.mapRowToEntry(row))
		if (filter.tags && filter.tags.length > 0)
			this.logTagQuery(filter, nowMs() - startedAt, rows.length)

		const nextCursor = entries.length > limit ? this.encodeCursor(entries[limit - 1]) : null

		return {
			entries: entries.slice(0, limit),
			cursor: nextCursor,
		}
	}

	/**
	 * Gap 12 (docs/designKnownGaps.md, section 10.1): a tag filter is a LIKE scan over a JSON column. Logs how long each one took, how
	 * many rows came back and how many rows the table holds (counted at most once a minute), and says whether it crossed the
	 * threshold at which a tags table is worth building.
	 */
	private tableRowsCache = { at: 0, rows: -1 }
	private logTagQuery(filter: MemoryFilter, ms: number, returned: number): void {
		if (!gapMetricsEnabled()) return
		const now = Date.now()
		const cache = this.tableRowsCache
		if (now - cache.at > 60_000) {
			cache.at = now
			this.db
				?.execute('SELECT COUNT(*) as cnt FROM memories')
				.then((r: any) => {
					cache.rows = r.rows?.[0]?.cnt ?? -1
				})
				.catch(() => {})
		}
		const slow = ms >= GAP_TAG_QUERY_SLOW_MS
		gapMetric('gap12', 'tag_query', {
			ms: Math.round(ms * 10) / 10,
			tags: filter.tags,
			type: filter.type ?? null,
			returned,
			tableRows: cache.rows,
			slow,
			verdict: slow
				? `BUILD the tags table (>= ${GAP_TAG_QUERY_SLOW_MS} ms)`
				: 'fine, no tags table needed',
		})
	}

	async count(filter?: MemoryFilter): Promise<number> {
		if (!this.db) throw new Error('Store not initialized')

		const { whereClause, params } = this.buildWhereClause(filter ?? {})
		const result = await this.db.execute(
			`SELECT COUNT(*) as cnt FROM memories ${whereClause}`,
			params
		)
		return (result.rows as any[])?.[0]?.cnt ?? 0
	}

	// ── Relations ────────────────────────────────────────────────────────────────

	async getRelations(entryId: string): Promise<MemoryRelation[]> {
		if (!this.db) throw new Error('Store not initialized')

		const result = await this.db.execute('SELECT * FROM memory_relations WHERE from_id = ?', [
			entryId,
		])

		const rows = (result.rows ?? []) as {
			to_id: string
			relation_type: string
			weight: number | null
			metadata: string | null
		}[]

		return rows.map((row) => ({
			targetId: String(row.to_id),
			type: row.relation_type as MemoryRelation['type'],
			weight: row.weight ?? undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}))
	}

	/** CB interface: putRelation({ sourceId, targetId, type, weight?, metadata? }) */
	async putRelation(relation: MemoryRelation & { sourceId: string }): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		const relationId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

		await this.db.execute(
			`INSERT OR REPLACE INTO memory_relations
       (id, from_id, to_id, relation_type, weight, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				relationId,
				relation.sourceId,
				relation.targetId,
				relation.type,
				relation.weight ?? null,
				relation.metadata ? JSON.stringify(relation.metadata) : null,
				new Date().toISOString(),
			]
		)
	}

	async deleteRelation(sourceId: string, targetId: string): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute('DELETE FROM memory_relations WHERE from_id = ? AND to_id = ?', [
			sourceId,
			targetId,
		])
	}

	// ── Full reset ───────────────────────────────────────────────────────────────

	async clear(): Promise<void> {
		if (!this.db) throw new Error('Store not initialized')

		await this.db.execute('DELETE FROM memories')
		await this.db.execute('DELETE FROM memory_relations')
		await this.db.execute('DELETE FROM working_memory')
	}

	// ── Private helpers ───────────────────────────────────────────────────────────

	private buildWhereClause(
		filter: MemoryFilter,
		cursor?: string
	): { whereClause: string; params: any[] } {
		const conditions: string[] = []
		const params: any[] = []

		// type - scalar or array
		if (filter.type) {
			const types = Array.isArray(filter.type) ? filter.type : [filter.type]
			if (types.length > 0) {
				conditions.push(`type IN (${types.map(() => '?').join(',')})`)
				params.push(...types)
			}
		}

		// ids - explicit ID list
		if (filter.ids && filter.ids.length > 0) {
			conditions.push(`id IN (${filter.ids.map(() => '?').join(',')})`)
			params.push(...filter.ids)
		}

		// lifecycleState filter
		if (filter.lifecycleState) {
			const states = Array.isArray(filter.lifecycleState)
				? filter.lifecycleState
				: [filter.lifecycleState]
			if (states.length > 0) {
				conditions.push(`lifecycle_state IN (${states.map(() => '?').join(',')})`)
				params.push(...states)
			}
		} else {
			// By default exclude soft-deleted entries
			conditions.push(`lifecycle_state != 'deleted'`)
		}

		// tags
		if (filter.tags && filter.tags.length > 0) {
			if (filter.tagMatchMode === 'any') {
				const orClauses = filter.tags.map(() => 'tags LIKE ?').join(' OR ')
				conditions.push(`(${orClauses})`)
				for (const tag of filter.tags) params.push(`%"${tag}"%`)
			} else {
				// AND (default)
				for (const tag of filter.tags) {
					conditions.push('tags LIKE ?')
					params.push(`%"${tag}"%`)
				}
			}
		}

		if (filter.minImportance !== undefined) {
			conditions.push('importance >= ?')
			params.push(filter.minImportance)
		}

		if (filter.minSalience !== undefined) {
			conditions.push('COALESCE(salience, importance, 0) >= ?')
			params.push(filter.minSalience)
		}

		if (filter.outcome && filter.outcome.length > 0) {
			conditions.push(`outcome IN (${filter.outcome.map(() => '?').join(',')})`)
			params.push(...filter.outcome)
		}

		if (filter.timeRange?.start) {
			conditions.push('created_at >= ?')
			params.push(filter.timeRange.start)
		}

		if (filter.timeRange?.end) {
			conditions.push('created_at <= ?')
			params.push(filter.timeRange.end)
		}

		if (filter.userId) {
			conditions.push('user_id = ?')
			params.push(filter.userId)
		}

		if (filter.agentId) {
			conditions.push('agent_id = ?')
			params.push(filter.agentId)
		}

		if (filter.sessionId) {
			conditions.push('session_id = ?')
			params.push(filter.sessionId)
		}

		// Cursor-based pagination: composite (created_at DESC, id DESC)
		if (cursor) {
			const decoded = this.decodeCursor(cursor)
			if (decoded) {
				conditions.push('(created_at < ? OR (created_at = ? AND id < ?))')
				params.push(decoded.createdAt, decoded.createdAt, decoded.id)
			}
		}

		const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

		return { whereClause, params }
	}

	private mapRowToEntry(row: any): MemoryEntry {
		return {
			id: row.id,
			type: row.type,
			title: row.title ?? undefined,
			content: row.content,
			createdAt: row.created_at,
			updatedAt: row.updated_at ?? undefined,
			tags: row.tags ? JSON.parse(row.tags) : [],
			entities: row.entities ? JSON.parse(row.entities) : [],
			importance: row.importance ?? undefined,
			confidence: row.confidence ?? undefined,
			salience: row.salience ?? undefined,
			outcome: row.outcome ?? undefined,
			sourceIds: row.source_ids ? JSON.parse(row.source_ids) : [],
			relations: row.relations ? JSON.parse(row.relations) : [],
			userId: row.user_id ?? undefined,
			agentId: row.agent_id ?? undefined,
			sessionId: row.session_id ?? undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : {},
			lifecycleState: row.lifecycle_state ?? 'active',
			retentionPolicy: row.retention_policy ?? undefined,
			retrievalCount: row.retrieval_count ?? 0,
			compressionLevel: row.compression_level ?? 0,
			synthesisQuality: row.synthesis_quality ?? undefined,
			synthesizedAt: row.synthesized_at ?? undefined,
			linkedProcedureIds: row.linked_procedure_ids ? JSON.parse(row.linked_procedure_ids) : [],
			isDurable:
				row.is_durable === null || row.is_durable === undefined ? undefined : !!row.is_durable,
			expiresAt: row.expires_at ?? undefined,
		}
	}

	private encodeCursor(entry: MemoryEntry): string {
		return Buffer.from(JSON.stringify({ c: entry.createdAt, i: entry.id })).toString('base64')
	}

	private decodeCursor(cursor: string): { createdAt: string; id: string } | null {
		try {
			const { c, i } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
			return { createdAt: c, id: i }
		} catch {
			return null
		}
	}
}

export default SQLiteStore
