export class SearchIndex {
	constructor() {
		console.warn('SearchIndex is not available on web.')
	}

	async init(): Promise<void> {
		console.warn('SearchIndex.init() is a no-op on web.')
		return Promise.resolve()
	}

	async initialize(): Promise<void> {
		console.warn('SearchIndex.initialize() is a no-op on web.')
		return Promise.resolve()
	}

	async indexFile(_filePath: string, _content: string): Promise<void> {
		console.warn('SearchIndex.indexFile() is a no-op on web.')
		return Promise.resolve()
	}

	async searchMemories(_query: string, _options: any = {}): Promise<any[]> {
		console.warn('SearchIndex.searchMemories() is a no-op on web.')
		return Promise.resolve([])
	}

	async listMemories(
		_options: { layer?: string; limit?: number; since?: number } = {}
	): Promise<any[]> {
		console.warn('SearchIndex.listMemories() is a no-op on web.')
		return Promise.resolve([])
	}
}
