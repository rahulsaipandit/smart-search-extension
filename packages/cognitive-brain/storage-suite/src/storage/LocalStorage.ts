/* LocalStorage.ts is a complex, hierarchical storage service specifically designed for managing a semantic memory system. 
__Platform Support:__
- Web: Uses IndexedDB for persistence
- Native (React Native): Uses Expo File System for file-based storage with directory management
__Data Model:__
- Handles complex objects with semantic layers for memory/goal management
- Generates permalinks, handles entities, persona traits, and temporal data
LocalStorage.ts handles structured MemoryEntry objects with rich metadata, supports multiple layers of memory (L0, L1, L2, goals), and integrates with a search index for efficient retrieval.
It uses the new Expo FileSystem Directory and File APIs for robust file management and is optimized for both React Native and web environments.

__Functionality:__
- Stores structured `MemoryEntry` objects with rich metadata (tags, importance, confidence, etc.)
- Uses a hierarchical directory structure: `L0-raw`, `L1-processed`, `L2-semantic`, `todos-goals`
- Serializes data to Markdown format with YAML frontmatter
- Supports search indexing, metadata tracking, and file integrity with checksums
- Provides storage statistics and layer-based querying

__Use Cases for when to use storage.ts versus LocalStorage.ts:__
- `LocalStorage`: Managing complex knowledge graphs, memory systems, or hierarchical content organization
- `storage.ts`: App preferences, user settings, authentication tokens, or other simple data persistence needs
*/
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import { SearchIndex } from './SearchIndex'

// Conditionally import idb for web platform only
let openDB: any = null

if (Platform.OS === 'web') {
	try {
		// Dynamic import for web platform
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const idbModule = require('idb')
		openDB = idbModule.openDB
	} catch (error) {
		console.warn('idb library not available on this platform:', error)
	}
}

// Type for IndexedDB database
type IDBDatabaseType = any

export interface MemoryEntry {
	id: string
	type: 'memory' | 'goal'
	layer: 'L0' | 'L1' | 'L2' | 'goals'
	title: string
	content: string
	timestamp: string
	permalink: string
	tags?: string[]
	importance?: number
	source_l0?: string[]
	source_l1?: string[]
	entities?: string[]
	confidence?: number
	persona_traits?: Record<string, any>
	status?: string
	priority?: string
	category?: string
	target_date?: string
}

export interface StorageConfig {
	basePath?: string
	enableSearchIndex?: boolean
	compressionEnabled?: boolean
	maxFileSize?: number
}

// Local Storage Service for persistent data with hierarchical memory system
export class LocalStorage {
	private _storagePath: string
	private _baseDirectory: string
	private _searchIndex?: SearchIndex
	private _config: StorageConfig
	private _isInitialized: boolean = false
	private _isWeb: boolean
	private _db!: IDBDatabaseType

	constructor(storagePath: string, config: StorageConfig = {}) {
		this._isWeb = Platform.OS === 'web'
		this._storagePath = storagePath
		this._config = {
			basePath: config.basePath,
			enableSearchIndex: config.enableSearchIndex ?? true,
			compressionEnabled: config.compressionEnabled ?? false,
			maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB default
			...config,
		}

		// Initialize _baseDirectory for both platforms for consistency
		if (this._isWeb) {
			// Web platform uses IndexedDB, so _baseDirectory is not used but we set a default
			this._baseDirectory = ''
		} else {
			// For React Native, we need to use absolute paths
			this._baseDirectory = config.basePath || this.resolveStoragePathSync(storagePath)
		}
	}

	private resolveStoragePathSync(storagePath: string): string {
		// For React Native, we need to use absolute paths. If a relative path is provided,
		// prepend it with the document directory to make it absolute
		if (!storagePath.startsWith('file://') && !storagePath.includes('/')) {
			// This is a relative path, make it absolute for React Native
			try {
				// Try to get documentDirectory synchronously if available
				const documentDir = (FileSystem as any).documentDirectory
				if (documentDir) {
					return `${documentDir}${storagePath}`
				}
			} catch {
				// documentDirectory not available, use fallback
			}
			// Fallback to a basic file:// path if documentDirectory is not available
			return `file://${storagePath}`
		}
		return storagePath
	}

	// Getter to access the storage path
	get storagePath(): string {
		return this._storagePath
	}

	async initialize(): Promise<void> {
		if (this._isInitialized) return

		if (this._isWeb) {
			this._db = await openDB('MemSoftStoreDB', 1, {
				upgrade(db: any) {
					db.createObjectStore('entries', { keyPath: 'id' })
				},
			})
		} else {
			try {
				// Ensure base directory exists
				await this.ensureDirectoryExists(this._baseDirectory)

				// Create hierarchical directory structure
				await this.createDirectoryStructure()

				// Initialize search index if enabled by getting the singleton instance
				if (this._config.enableSearchIndex) {
					this._searchIndex = SearchIndex.getInstance()
				}
			} catch (error) {
				throw new Error(`Failed to initialize LocalStorage: ${error}`, { cause: error })
			}
		}
		this._isInitialized = true
	}

	private async ensureDirectoryExists(directoryPath: string): Promise<void> {
		try {
			const dirInfo = await FileSystem.getInfoAsync(directoryPath)
			if (!dirInfo.exists) {
				await FileSystem.makeDirectoryAsync(directoryPath, { intermediates: true })
			}
		} catch (error) {
			throw new Error(`Failed to create directory ${directoryPath}: ${error}`, { cause: error })
		}
	}

	private async createDirectoryStructure(): Promise<void> {
		const directories = ['L0-raw', 'L1-processed', 'L2-semantic', 'todos-goals', 'metadata']

		for (const dir of directories) {
			const fullPath = `${this._baseDirectory}/${dir}`
			await this.ensureDirectoryExists(fullPath)
		}
	}

	private getDirectoryForLayer(layer: string): string {
		const layerMap: Record<string, string> = {
			L0: 'L0-raw',
			L1: 'L1-processed',
			L2: 'L2-semantic',
			goals: 'todos-goals',
		}
		return layerMap[layer] || 'L0-raw'
	}

	private generateFilePath(entry: MemoryEntry): string {
		const directory = this.getDirectoryForLayer(entry.layer)
		const sanitizedTitle = entry.permalink.replace(/[^a-zA-Z0-9-_]/g, '_')
		return `${this._baseDirectory}/${directory}/${sanitizedTitle}.md`
	}

	private serializeToMarkdown(entry: MemoryEntry): string {
		const frontmatter: Record<string, any> = {
			title: entry.title,
			type: entry.type,
			layer: entry.layer,
			timestamp: entry.timestamp,
			permalink: entry.permalink,
			id: entry.id,
		}

		// Add optional fields if they exist
		if (entry.tags?.length) frontmatter.tags = entry.tags
		if (entry.importance !== undefined) frontmatter.importance = entry.importance
		if (entry.source_l0?.length) frontmatter.source_l0 = entry.source_l0
		if (entry.source_l1?.length) frontmatter.source_l1 = entry.source_l1
		if (entry.entities?.length) frontmatter.entities = entry.entities
		if (entry.confidence !== undefined) frontmatter.confidence = entry.confidence
		if (entry.persona_traits && Object.keys(entry.persona_traits).length) {
			frontmatter.persona_traits = entry.persona_traits
		}
		if (entry.status) frontmatter.status = entry.status
		if (entry.priority) frontmatter.priority = entry.priority
		if (entry.category) frontmatter.category = entry.category
		if (entry.target_date) frontmatter.target_date = entry.target_date

		const frontmatterYaml = Object.entries(frontmatter)
			.map(([key, value]) => {
				const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value
				return `${key}: ${serializedValue}`
			})
			.join('\n')

		return `---\n${frontmatterYaml}\n---\n\n${entry.content}\n`
	}

	private parseMarkdown(content: string): MemoryEntry | null {
		try {
			const parts = content.split('---')
			if (parts.length < 3 || !parts[1]) return null

			const frontmatterLines = parts[1].trim().split('\n')
			const frontmatter: Record<string, any> = {}

			for (const line of frontmatterLines) {
				const colonIndex = line.indexOf(':')
				if (colonIndex === -1) continue

				const key = line.substring(0, colonIndex).trim()
				const valueStr = line.substring(colonIndex + 1).trim()

				try {
					frontmatter[key] = JSON.parse(valueStr)
				} catch {
					frontmatter[key] = valueStr
				}
			}

			const body = parts.slice(2).join('---').trim()

			return {
				id: frontmatter.id || frontmatter.permalink,
				type: frontmatter.type,
				layer: frontmatter.layer,
				title: frontmatter.title,
				content: body,
				timestamp: frontmatter.timestamp,
				permalink: frontmatter.permalink,
				tags: frontmatter.tags,
				importance: frontmatter.importance,
				source_l0: frontmatter.source_l0,
				source_l1: frontmatter.source_l1,
				entities: frontmatter.entities,
				confidence: frontmatter.confidence,
				persona_traits: frontmatter.persona_traits,
				status: frontmatter.status,
				priority: frontmatter.priority,
				category: frontmatter.category,
				target_date: frontmatter.target_date,
			}
		} catch (error) {
			console.error('Failed to parse markdown:', error)
			return null
		}
	}

	async store(key: string, data: MemoryEntry): Promise<void> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			await this._db.put('entries', data)
		} else {
			try {
				const filePath = this.generateFilePath(data)
				const serializedData = this.serializeToMarkdown(data)

				// Check file size limit
				const maxFileSize = this._config.maxFileSize || 10 * 1024 * 1024
				if (serializedData.length > maxFileSize) {
					throw new Error(`File size exceeds maximum limit of ${maxFileSize} bytes`)
				}

				// Write file using FileSystem API
				await FileSystem.writeAsStringAsync(filePath, serializedData)

				// Index in search database if enabled
				if (this._searchIndex) {
					await this._searchIndex.indexFile(filePath, serializedData)
				}

				// Store metadata
				await this.storeMetadata(key, {
					fileUri: filePath,
					lastModified: new Date().toISOString(),
					size: serializedData.length,
					checksum: this.generateChecksum(serializedData),
				})
			} catch (error) {
				throw new Error(`Failed to store data for key ${key}: ${error}`, { cause: error })
			}
		}
	}

	async retrieve(key: string): Promise<MemoryEntry | null> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			return this._db.get('entries', key)
		} else {
			try {
				const metadata = await this.retrieveMetadata(key)
				if (!metadata?.fileUri) return null

				const fileInfo = await FileSystem.getInfoAsync(metadata.fileUri)
				if (!fileInfo.exists) return null

				const content = await FileSystem.readAsStringAsync(metadata.fileUri)
				return this.parseMarkdown(content)
			} catch (error) {
				throw new Error(`Failed to retrieve data for key ${key}: ${error}`, { cause: error })
			}
		}
	}

	async remove(key: string): Promise<void> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			await this._db.delete('entries', key)
		} else {
			try {
				const metadata = await this.retrieveMetadata(key)
				if (metadata?.fileUri) {
					// Remove file
					await FileSystem.deleteAsync(metadata.fileUri)

					// Remove from search index if exists
					if (this._searchIndex) {
						// Note: SearchIndex doesn't have a remove method, so we re-index with empty content
						await this._searchIndex.indexFile(metadata.fileUri, '')
					}
				}

				// Remove metadata
				await this.removeMetadata(key)
			} catch (error) {
				throw new Error(`Failed to remove data for key ${key}: ${error}`, { cause: error })
			}
		}
	}

	async clear(): Promise<void> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			await this._db.clear('entries')
		} else {
			try {
				// Delete all files in each subdirectory
				const layers = ['L0-raw', 'L1-processed', 'L2-semantic', 'todos-goals', 'metadata']

				for (const layer of layers) {
					try {
						const layerDirPath = `${this._baseDirectory}/${layer}`
						const items = await FileSystem.readDirectoryAsync(layerDirPath)

						// Delete each file individually
						for (const item of items) {
							const filePath = `${layerDirPath}/${item}`
							await FileSystem.deleteAsync(filePath)
						}
					} catch (error) {
						// Directory might not exist, which is fine
						console.warn(`Failed to clear directory ${layer}:`, error)
					}
				}

				// Recreate clean directory structure
				await this.createDirectoryStructure()

				// Clear search index if enabled
				if (this._searchIndex) {
					// Note: SearchIndex doesn't have a clear method, so we reinitialize it
					// This will be handled by the DatabaseManager
				}
			} catch (error) {
				throw new Error(`Failed to clear storage: ${error}`, { cause: error })
			}
		}
	}

	async listEntries(layer?: string, limit?: number): Promise<MemoryEntry[]> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			const allEntries = await this._db.getAll('entries')
			let filteredEntries = allEntries
			if (layer) {
				filteredEntries = allEntries.filter((entry: any) => entry.layer === layer)
			}
			return limit ? filteredEntries.slice(0, limit) : filteredEntries
		} else {
			try {
				const targetDirPath = layer
					? `${this._baseDirectory}/${this.getDirectoryForLayer(layer)}`
					: this._baseDirectory

				const items = await FileSystem.readDirectoryAsync(targetDirPath)
				const entries: MemoryEntry[] = []
				let count = 0

				for (const item of items) {
					if (item.endsWith('.md') && (!limit || count < limit)) {
						try {
							const filePath = `${targetDirPath}/${item}`
							const content = await FileSystem.readAsStringAsync(filePath)
							const entry = this.parseMarkdown(content)
							if (entry) {
								entries.push(entry)
								count++
							}
						} catch (error) {
							console.warn(`Failed to parse file ${item}:`, error)
						}
					}
				}

				return entries
			} catch (error) {
				throw new Error(`Failed to list entries: ${error}`, { cause: error })
			}
		}
	}

	private async storeMetadata(key: string, metadata: any): Promise<void> {
		const metadataPath = `${this._baseDirectory}/metadata/${key}.json`
		const serializedMetadata = JSON.stringify(metadata)
		await FileSystem.writeAsStringAsync(metadataPath, serializedMetadata)
	}

	private async retrieveMetadata(key: string): Promise<any> {
		const metadataPath = `${this._baseDirectory}/metadata/${key}.json`
		try {
			const fileInfo = await FileSystem.getInfoAsync(metadataPath)
			if (!fileInfo.exists) return null
			const content = await FileSystem.readAsStringAsync(metadataPath)
			return JSON.parse(content)
		} catch {
			return null
		}
	}

	private async removeMetadata(key: string): Promise<void> {
		const metadataPath = `${this._baseDirectory}/metadata/${key}.json`
		try {
			await FileSystem.deleteAsync(metadataPath)
		} catch {
			// File might not exist, which is fine
		}
	}

	private generateChecksum(data: string): string {
		// Simple checksum for file integrity
		let hash = 0
		for (let i = 0; i < data.length; i++) {
			const char = data.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32-bit integer
		}
		return hash.toString(16)
	}

	// Utility method to get storage statistics
	async getStorageStats(): Promise<{
		totalFiles: number
		totalSize: number
		layers: Record<string, { count: number; size: number }>
	}> {
		if (!this._isInitialized) {
			throw new Error('LocalStorage not initialized. Call initialize() first.')
		}

		if (this._isWeb) {
			const allEntries = await this._db.getAll('entries')
			const stats = {
				totalFiles: allEntries.length,
				totalSize: 0, // Size calculation is complex with IndexedDB, so we'll leave it as 0 for now
				layers: {} as Record<string, { count: number; size: number }>,
			}
			allEntries.forEach((entry: any) => {
				if (!stats.layers[entry.layer]) {
					stats.layers[entry.layer] = { count: 0, size: 0 }
				}
				stats.layers[entry.layer].count++
			})
			return stats
		} else {
			const stats = {
				totalFiles: 0,
				totalSize: 0,
				layers: {} as Record<string, { count: number; size: number }>,
			}

			const layers = ['L0-raw', 'L1-processed', 'L2-semantic', 'todos-goals']

			for (const layer of layers) {
				try {
					const layerDirPath = `${this._baseDirectory}/${layer}`
					const items = await FileSystem.readDirectoryAsync(layerDirPath)
					stats.layers[layer] = { count: 0, size: 0 }

					for (const item of items) {
						if (item.endsWith('.md')) {
							const filePath = `${layerDirPath}/${item}`
							const fileInfo = await FileSystem.getInfoAsync(filePath)
							if (fileInfo.exists) {
								stats.layers[layer].count++
								stats.layers[layer].size += fileInfo.size || 0
								stats.totalFiles++
								stats.totalSize += fileInfo.size || 0
							}
						}
					}
				} catch {
					stats.layers[layer] = { count: 0, size: 0 }
				}
			}
			return stats
		}
	}
}
