// Mock SecureStore for web platform since expo-secure-store is not available on web
import { Platform } from 'react-native'

const SecureStore = {
	getItemAsync: async (key: string) => {
		throw new Error('SecureStore is not available on web platform')
	},
	setItemAsync: async (key: string, value: string) => {
		throw new Error('SecureStore is not available on web platform')
	},
	deleteItemAsync: async (key: string) => {
		throw new Error('SecureStore is not available on web platform')
	},
}

// ------------------------------------------------------------------ //
// Config
// ------------------------------------------------------------------ //

export interface StorageConfig {
	keychainService?: string
	keyPrefix?: string
}

export interface StoreOptions {
	/** Time-to-live in milliseconds. Must be > 0. Omit for no expiry. */
	ttl?: number
}

// ------------------------------------------------------------------ //
// Internal envelope written to storage
// ------------------------------------------------------------------ //

interface StorageEnvelope<T> {
	data: T
	expiresAt: number | null // Unix ms, or null if no TTL
}

// ------------------------------------------------------------------ //
// Mutex - serialises registry read-modify-write operations
// ------------------------------------------------------------------ //

class Mutex {
	private queue: (() => void)[] = []
	private locked = false

	async acquire(): Promise<() => void> {
		return new Promise((resolve) => {
			const tryAcquire = () => {
				if (!this.locked) {
					this.locked = true
					resolve(() => this.release())
				} else {
					this.queue.push(tryAcquire)
				}
			}
			tryAcquire()
		})
	}

	private release(): void {
		this.locked = false
		const next = this.queue.shift()
		if (next) next()
	}
}

// ------------------------------------------------------------------ //
// SecureStorage
// ------------------------------------------------------------------ //

export class SecureStorage {
	private readonly config: Required<StorageConfig>
	private readonly REGISTRY_KEY: string

	// Fix #8: separate limits per platform
	private readonly SECURE_STORE_LIMIT = 2048
	private readonly ASYNC_STORAGE_LIMIT = 6 * 1024 * 1024 // 6 MB practical limit

	private readonly registryMutex = new Mutex()
	private readonly isWeb = Platform.OS === 'web'

	constructor(config: StorageConfig = {}) {
		this.config = {
			keychainService: config.keychainService ?? 'memsoftstore',
			keyPrefix: config.keyPrefix ?? 'memsoft:',
		}
		this.REGISTRY_KEY = `${this.config.keyPrefix}__key_registry__`
	}

	// ---------------------------------------------------------------- //
	// Public API
	// ---------------------------------------------------------------- //

	async store<T>(key: string, data: T, options: StoreOptions = {}): Promise<void> {
		// Fix #6: reject empty keys
		this.assertValidKey(key)

		if (options.ttl !== undefined && options.ttl <= 0) {
			throw new Error('TTL must be greater than 0')
		}

		try {
			const envelope: StorageEnvelope<T> = {
				data,
				expiresAt: options.ttl != null ? Date.now() + options.ttl : null,
			}

			await this.setItem(this.prefixKey(key), JSON.stringify(envelope))
			await this.addToRegistry(key)
		} catch (error) {
			throw new Error(`Failed to store data: ${(error as Error).message}`, { cause: error })
		}
	}

	async retrieve<T>(key: string): Promise<T | null> {
		this.assertValidKey(key)

		try {
			const raw = await this.getItem(this.prefixKey(key))
			if (!raw) return null

			// Fix #7: validate envelope shape before trusting the cast
			let envelope: StorageEnvelope<T>
			try {
				const parsed = JSON.parse(raw)
				if (!this.isValidEnvelope(parsed)) {
					throw new SyntaxError('Invalid envelope shape')
				}
				envelope = parsed as StorageEnvelope<T>
			} catch {
				console.warn(`Storage: corrupted data at key "${key}", discarding.`)
				await this.remove(key)
				return null
			}

			// TTL check - evict and return null if expired
			if (envelope.expiresAt !== null && Date.now() > envelope.expiresAt) {
				await this.remove(key)
				return null
			}

			return envelope.data
		} catch (error) {
			throw new Error(`Failed to retrieve data: ${(error as Error).message}`, { cause: error })
		}
	}

	async remove(key: string): Promise<void> {
		this.assertValidKey(key)

		try {
			await this.removeItem(this.prefixKey(key))
			await this.removeFromRegistry(key)
		} catch (error) {
			throw new Error(`Failed to remove data: ${(error as Error).message}`, { cause: error })
		}
	}

	// Fix #3 + #4: clear() now removes all items first, then clears the
	// registry in a single best-effort pass. Errors are collected rather
	// than aborting early, so the registry is always wiped at the end.
	async clear(): Promise<void> {
		const release = await this.registryMutex.acquire()
		try {
			const keys = await this.readRegistry()

			// Collect errors rather than short-circuiting on the first failure
			const errors: Error[] = []
			await Promise.all(
				keys.map((key) =>
					this.removeItem(this.prefixKey(key)).catch((e) => errors.push(e as Error))
				)
			)

			// Always wipe the registry, even if some item removals failed
			await this.removeItem(this.REGISTRY_KEY)

			if (errors.length > 0) {
				console.warn(`Storage: ${errors.length} item(s) failed to remove during clear.`)
			}
		} catch (error) {
			throw new Error(`Failed to clear storage: ${(error as Error).message}`, { cause: error })
		} finally {
			release()
		}
	}

	// Fix #1: hasKey() no longer calls retrieve() - it checks existence
	// directly without triggering TTL eviction as a side effect.
	async hasKey(key: string): Promise<boolean> {
		this.assertValidKey(key)

		try {
			const raw = await this.getItem(this.prefixKey(key))
			if (!raw) return false

			// Parse to check TTL without evicting
			try {
				const parsed = JSON.parse(raw)
				if (!this.isValidEnvelope(parsed)) return false
				if (parsed.expiresAt !== null && Date.now() > parsed.expiresAt) return false
				return true
			} catch {
				return false
			}
		} catch {
			return false
		}
	}

	async getAllKeys(): Promise<string[]> {
		const release = await this.registryMutex.acquire()
		try {
			return await this.readRegistry()
		} finally {
			release()
		}
	}

	// Fix #2: evictExpired() now has a dedicated private helper that
	// checks and evicts without fetching or returning the full payload.
	async evictExpired(): Promise<void> {
		const keys = await this.getAllKeys()
		await Promise.all(keys.map((key) => this.evictIfExpired(key)))
	}

	// ---------------------------------------------------------------- //
	// Registry helpers
	// ---------------------------------------------------------------- //

	private async addToRegistry(key: string): Promise<void> {
		if (key === this.REGISTRY_KEY) return
		const release = await this.registryMutex.acquire()
		try {
			const keys = await this.readRegistry()
			if (!keys.includes(key)) {
				await this.writeRegistry([...keys, key])
			}
		} finally {
			release()
		}
	}

	private async removeFromRegistry(key: string): Promise<void> {
		const release = await this.registryMutex.acquire()
		try {
			const keys = await this.readRegistry()
			await this.writeRegistry(keys.filter((k) => k !== key))
		} finally {
			release()
		}
	}

	// Fix #5: readRegistry() is always called from within a mutex lock
	// acquired by the caller. writeRegistry() during corruption recovery
	// is safe here because we already hold the lock.
	private async readRegistry(): Promise<string[]> {
		const raw = await this.getItem(this.REGISTRY_KEY)
		if (!raw) return []
		try {
			const parsed = JSON.parse(raw)
			if (!Array.isArray(parsed)) throw new SyntaxError('Registry is not an array')
			return parsed as string[]
		} catch {
			console.warn('Storage: corrupted key registry, resetting.')
			try {
				// Safe: caller always holds the mutex before calling readRegistry()
				await this.writeRegistry([])
			} catch (writeError) {
				console.error('Storage: failed to reset corrupted registry:', (writeError as Error).message)
			}
			return []
		}
	}

	private async writeRegistry(keys: string[]): Promise<void> {
		await this.setItem(this.REGISTRY_KEY, JSON.stringify(keys))
	}

	// ---------------------------------------------------------------- //
	// TTL eviction helper (no payload returned - fix #2)
	// ---------------------------------------------------------------- //

	private async evictIfExpired(key: string): Promise<void> {
		try {
			const raw = await this.getItem(this.prefixKey(key))
			if (!raw) return

			let parsed: unknown
			try {
				parsed = JSON.parse(raw)
			} catch {
				// Corrupted - evict
				await this.remove(key)
				return
			}

			if (!this.isValidEnvelope(parsed)) {
				await this.remove(key)
				return
			}

			if (parsed.expiresAt !== null && Date.now() > parsed.expiresAt) {
				await this.remove(key)
			}
		} catch {
			// Best-effort - don't let one bad key abort the whole sweep
		}
	}

	// ---------------------------------------------------------------- //
	// Envelope validation - fix #7
	// ---------------------------------------------------------------- //

	private isValidEnvelope(parsed: unknown): parsed is StorageEnvelope<unknown> {
		return (
			typeof parsed === 'object' &&
			parsed !== null &&
			'data' in parsed &&
			'expiresAt' in parsed &&
			(typeof (parsed as StorageEnvelope<unknown>).expiresAt === 'number' ||
				(parsed as StorageEnvelope<unknown>).expiresAt === null)
		)
	}

	// ---------------------------------------------------------------- //
	// Key helpers
	// ---------------------------------------------------------------- //

	private prefixKey(key: string): string {
		if (key.startsWith(this.config.keyPrefix)) return key
		return `${this.config.keyPrefix}${key}`
	}

	// Fix #6: validates key is non-empty and not already prefixed
	private assertValidKey(key: string): void {
		if (!key || key.trim().length === 0) {
			throw new Error('Storage key must not be empty')
		}
		if (key.startsWith(this.config.keyPrefix)) {
			throw new Error(
				`Key "${key}" must not include the storage prefix "${this.config.keyPrefix}". Pass the bare key only.`
			)
		}
	}

	// ---------------------------------------------------------------- //
	// Low-level storage - single place for platform branching
	// ---------------------------------------------------------------- //

	private async getItem(key: string): Promise<string | null> {
		if (this.isWeb) {
			// On web, use localStorage directly
			if (typeof localStorage !== 'undefined') {
				return localStorage.getItem(key)
			}
			return null
		}
		return SecureStore.getItemAsync(key)
	}

	// Fix #8: size limit enforced on both platforms with appropriate thresholds
	private async setItem(key: string, value: string): Promise<void> {
		const limit = this.isWeb ? this.ASYNC_STORAGE_LIMIT : this.SECURE_STORE_LIMIT
		if (value.length > limit) {
			throw new Error(
				`Value for key "${key}" exceeds the ${this.isWeb ? 'localStorage' : 'SecureStore'} ` +
					`limit of ${limit} bytes (${value.length} bytes). Consider splitting into smaller keys.`
			)
		}

		if (this.isWeb) {
			// On web, use localStorage directly
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(key, value)
			}
		} else {
			await SecureStore.setItemAsync(key, value)
		}
	}

	private async removeItem(key: string): Promise<void> {
		if (this.isWeb) {
			// On web, use localStorage directly
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem(key)
			}
		} else {
			await SecureStore.deleteItemAsync(key)
		}
	}
}
