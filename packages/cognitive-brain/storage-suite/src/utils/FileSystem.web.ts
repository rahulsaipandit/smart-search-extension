// FileSystem.web.js
// FileSystem.web.js for Web Platform and FileSystem.native.js for Native Platform
// --- fileSystem.web.js ---
import { fileOpen, fileSave } from 'browser-fs-access'
import { get, set } from 'idb-keyval'

import { log } from './logger'

// Type definitions for options
interface DownloadOptions {
	onProgress?: (progress: { percent: number }) => void
	headers?: Record<string, string>
}

interface PickDocumentOptions {
	type?: string
}

const FileSystem = {
	// --- Core Operations ---
	readFile: async (fileHandle: any) => {
		const file = await fileHandle.getFile()
		return file.text()
	},

	writeFile: async (fileName: string, content: string, _encoding = 'utf8', options = {}) => {
		const blob = new Blob([content], { type: 'text/plain' })
		await fileSave(blob, { fileName })
		return true
	},

	// --- File Download ---
	downloadFile: async (url: string, fileName: string, options: DownloadOptions = {}) => {
		try {
			const response = await fetch(url, { headers: options.headers })
			if (!response.ok) throw new Error(`HTTP ${response.status}`)

			const reader = response.body?.getReader()
			if (!reader) throw new Error('Response body is null')

			const contentLengthStr = response.headers.get('Content-Length')
			const contentLength = contentLengthStr ? +contentLengthStr : 0
			let receivedLength = 0
			const chunks: any[] = []

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				chunks.push(value)
				receivedLength += value.length
				if (contentLength > 0) {
					options.onProgress?.({
						percent: Math.round((receivedLength / contentLength) * 100),
					})
				}
			}

			const blob = new Blob(chunks)
			await fileSave(blob, {
				fileName: sanitizeFilename(fileName || extractFilenameFromUrl(url)),
			})
			return true
		} catch (error: any) {
			throw new Error(`DOWNLOAD_FAILED: ${error.message}`, { cause: error })
		}
	},

	// --- File Picking ---
	pickDocument: async (options: PickDocumentOptions = {}) => {
		try {
			const fileHandle = await fileOpen({
				mimeTypes: [options.type || '*/*'],
				multiple: false,
			})
			return fileHandle
		} catch (error: any) {
			if (error.name === 'AbortError') return null
			throw error
		}
	},

	// --- File Sharing Stub ---
	shareFile: async (fileUri: string, options = {}) => {
		log.debug('[Web] Sharing not supported. File URI:', fileUri)
	},

	// --- Orientation APIs Stub ---
	lockScreenOrientation: async () => {
		log.debug('[Web] Screen orientation lock is not supported.')
	},

	unlockScreenOrientation: async () => {
		log.debug('[Web] Screen orientation unlock is not supported.')
	},

	// --- IDB Fallbacks ---
	readFileIDB: async (fileName: string) => (await get(fileName))?.content,
	writeFileIDB: async (fileName: string, content: string) => {
		await set(fileName, {
			content,
			metadata: {
				size: content.length,
				lastModified: Date.now(),
			},
		})
	},
}

// --- Shared Helpers ---
const sanitizeFilename = (name: string) =>
	name?.replace(/[^a-zA-Z0-9_\-.]+/g, '_') || `file_${Date.now()}`

const extractFilenameFromUrl = (url: string) => url.split('/').pop()?.split('?')[0] || 'download'

export default FileSystem
