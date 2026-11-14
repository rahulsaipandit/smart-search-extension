import type { DB } from '@op-engineering/op-sqlite'

import { log } from '../utils/logger'

// Platform-conditional imports
let open: ((config: { name: string }) => DB) | undefined
const canUseNativeSQLite = (() => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Platform } = require('react-native')
		return Platform.OS !== 'web'
	} catch {
		return false
	}
})()

if (canUseNativeSQLite) {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		;({ open } = require('@op-engineering/op-sqlite'))
	} catch {
		// op-sqlite not available - this is okay for web builds
		console.warn('[DatabaseManager] op-sqlite not available on this platform')
	}
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- DB resolves to `any` because op-sqlite is optional and its types are absent in web builds
let db: DB | null = null
let initializationPromise: Promise<void> | null = null

/**
 * Manages a single, global database connection and its initialization.
 * This ensures that the database is opened only once and that all setup
 * operations happen in a predictable order, preventing race conditions
 * and "database is locked" errors.
 */
export const getDatabase = () => {
	// Return null/undefined database state for web platforms
	if (!canUseNativeSQLite || !open) {
		log.debug('[DatabaseManager] Database operations unavailable on this platform')
		return { db: null, initializationPromise: null }
	}

	if (!initializationPromise) {
		initializationPromise = (async () => {
			try {
				log.debug('[DatabaseManager] Initializing database...')
				db = open({ name: 'memsoftstore.db' })

				if (!db) {
					throw new Error('Failed to open database')
				}

				// Set WAL mode for better concurrency
				await db.execute('PRAGMA journal_mode = WAL;')

				// --- Schema for NativeStorageManager ---
				await db.execute(
					`CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`
				)

				await db.execute(
					`CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(
              id,                 -- Unique identifier (permalink or UUID)
              user_id,
              type,               -- 'memory' or 'goal'
              title,
              content,            -- Body content
              layer,              -- L0, L1, L2, or goals
              tags,               -- JSON array of tags
              timestamp,          -- ISO timestamp
              importance,
              source_l0,          -- JSON array of source file permalinks
              source_l1,          -- JSON array of source file permalinks
              entities,           -- JSON array of extracted entities
              confidence,
              persona_traits,     -- JSON object of persona traits (L2 only)

              -- Goal-specific fields
              status,             -- Goal status (pending, in-progress, completed, cancelled)
              priority,           -- Goal priority (high, medium, low)
              category,           -- Goal category (personal, professional, learning, etc.)
              target_date         -- Goal target completion date (ISO timestamp)
            );
          `
				)

				// --- Schema for VectorStore ---
				await db.execute(`
          CREATE TABLE IF NOT EXISTS vectors (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            vector TEXT, -- JSON serialized vector
            metadata TEXT, -- JSON serialized metadata
            text_content TEXT,
            created_at DATETIME,
            updated_at DATETIME
          );
        `)

				await db.execute('CREATE INDEX IF NOT EXISTS idx_user_id ON vectors(user_id);')
				await db.execute('CREATE INDEX IF NOT EXISTS idx_created_at ON vectors(created_at);')

				try {
					await db.execute(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vectors_search USING vec0(
                    id TEXT PRIMARY KEY,
                    vector BLOB(1536) -- float[384] * 4 bytes = 1536 bytes
                );
            `)
				} catch {
					log.debug('[DatabaseManager] Vector search index already exists or not supported')
				}

				// --- Schema for user-authored Skill packages ---
				await db.execute(`
          CREATE TABLE IF NOT EXISTS user_skills (
            id               TEXT PRIMARY KEY,
            name             TEXT UNIQUE NOT NULL,
            display_name     TEXT NOT NULL,
            description      TEXT NOT NULL,
            tags             TEXT NOT NULL,
            instruction_body TEXT NOT NULL,
            version          TEXT NOT NULL,
            author           TEXT NOT NULL,
            score_threshold  REAL DEFAULT 0.70,
            is_built_in      INTEGER DEFAULT 0,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
          );
        `)
				await db.execute('CREATE INDEX IF NOT EXISTS idx_user_skills_name ON user_skills(name);')

				log.debug('[DatabaseManager] Database initialized successfully.')
			} catch (error) {
				console.error('[DatabaseManager] Database initialization failed:', error)
				// Reset promise on failure to allow for a retry
				initializationPromise = null
				db = null
				throw error
			}
		})()
	}

	return { db, initializationPromise }
}
