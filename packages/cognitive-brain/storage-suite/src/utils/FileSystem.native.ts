// --- fileSystem.native.js ---
// FileSystem.web.js for Web Platform and FileSystem.native.js for Native Platform
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as ScreenOrientation from 'expo-screen-orientation'
import * as Sharing from 'expo-sharing'
import { PermissionsAndroid, Platform } from 'react-native'

// Type declarations to handle API inconsistencies
declare module 'expo-file-system' {
	// eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation: namespace merges static members into the expo-file-system class
	namespace File {
		function downloadFileAsync(
			url: string,
			destination: Directory | File,
			options?: any
		): Promise<File>
	}
}
// Simple UUID replacement for React Native compatibility
const uuidv4 = () => {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

// Type definitions for options
interface WriteFileOptions {
	append?: boolean
}

interface DownloadOptions {
	onProgress?: (progress: { percent: number }) => void
	headers?: Record<string, string>
}

interface PickDocumentOptions {
	type?: string
}

interface ShareFileOptions {
	mimeType?: string
	dialogTitle?: string
}

const FileSystemAPI = {
	// --- Core File Operations ---
	readFile: async (filePath: string) => {
		try {
			const file = new File(filePath)
			if (!file.exists) {
				throw new Error('File does not exist')
			}
			return await file.text()
		} catch (error: any) {
			throw new Error(`READ_FAILED: ${error.message}`, { cause: error })
		}
	},

	writeFile: async (
		filePath: string,
		content: string,
		encoding?: any,
		options: WriteFileOptions = {}
	) => {
		try {
			const file = new File(filePath)
			// Append manually since expo-file-system does not support append
			if (options.append && file.exists) {
				const prev = await file.text()
				content = prev + content
			}
			file.write(content)
			return true
		} catch (error: any) {
			throw new Error(`WRITE_FAILED: ${error.message}`, { cause: error })
		}
	},

	// --- File Download ---
	downloadFile: async (url: string, fileName: string, options: DownloadOptions = {}) => {
		try {
			const sanitizedFileName = sanitizeFilename(fileName || extractFilenameFromUrl(url))

			if (Platform.OS === 'android') {
				const granted = await requestStoragePermission()
				if (granted !== 'granted') throw new Error('Storage permission denied')
			}

			const downloadDir = getDownloadDir()
			const destinationDir = Directory.fromUri(downloadDir)

			// Use new download API with progress callback
			const downloadedFile = await File.downloadFileAsync(url, destinationDir, {
				headers: options.headers,
				onDownloadProgress: options.onProgress
					? (progress: any) => {
							const percent = Math.round(
								(progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100
							)
							options.onProgress!({ percent })
						}
					: undefined,
			})

			if (Platform.OS === 'ios') {
				await ensureFileVisibilityIOS(downloadedFile.uri, sanitizedFileName)
			}
			return downloadedFile.uri
		} catch (error: any) {
			throw new Error(`DOWNLOAD_FAILED: ${error.message}`, { cause: error })
		}
	},

	// --- File Picking ---
	pickDocument: async (options: PickDocumentOptions = {}) => {
		const result = await DocumentPicker.getDocumentAsync({
			type: options.type || '*/*',
			copyToCacheDirectory: false,
		})

		if (result.canceled) return null

		// Return first asset in expo-document-picker format
		const asset = result.assets[0]
		return {
			uri: asset.uri,
			name: asset.name,
			size: asset.size,
			type: asset.mimeType,
		}
	},

	// --- File Sharing ---
	shareFile: async (fileUri: string, options: ShareFileOptions = {}) => {
		try {
			const isAvailable = await Sharing.isAvailableAsync()
			if (!isAvailable) throw new Error('Sharing is not available on this device')
			await Sharing.shareAsync(fileUri, {
				mimeType: options.mimeType,
				dialogTitle: options.dialogTitle || 'Share File',
			})
		} catch (error: any) {
			throw new Error(`SHARE_FAILED: ${error.message}`, { cause: error })
		}
	},

	// --- Orientation APIs ---
	lockScreenOrientation: async () => {
		await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
	},

	unlockScreenOrientation: async () => {
		await ScreenOrientation.unlockAsync()
	},

	// --- Additional Utilities ---
	exists: async (filePath: string) => {
		const file = new File(filePath)
		return file.exists
	},

	getMetadata: async (filePath: string) => {
		const file = new File(filePath)
		if (file.exists) {
			const info = file.info()
			return {
				size: info.size,
				lastModified: info.modificationTime ? info.modificationTime * 1000 : undefined,
			}
		}
		return {
			size: 0,
			lastModified: undefined,
		}
	},
}

// --- Helpers ---
const sanitizeFilename = (name: string) =>
	name?.replace(/[^a-zA-Z0-9_\-.]+/g, '_') || `file_${uuidv4().slice(0, 8)}`

const extractFilenameFromUrl = (url: string) =>
	url.split('/').pop()?.split('?')[0] || `download_${Date.now()}`

const getDownloadDir = () => Paths.document.uri

const requestStoragePermission = async () => {
	if (Platform.OS !== 'android' || Number(Platform.Version) >= 33) return 'granted'
	return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE)
}

const ensureFileVisibilityIOS = async (filePath: string, fileName: string) => {
	// Optional iOS visibility logic if needed
}

export default FileSystemAPI
