import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import * as MimeTypes from 'react-native-mime-types'

import { log } from './logger'

// Type definitions for options
interface PickDocumentOptions {
	type?: string | string[]
	copyToCacheDirectory?: boolean
	multiple?: boolean
}

interface SaveFileOptions {
	mimeType?: string
	share?: boolean
	directory?: string
	append?: boolean
	isCopyOperation?: boolean
}

interface ShareFileOptions {
	mimeType?: string
	dialogTitle?: string
}

/**
 * Picks a document using Expo's DocumentPicker
 * @param {Object} [options] - Document picker options
 * @param {string|string[]} [options.type='*.*'] - MIME type(s) of documents to pick
 * @param {boolean} [options.copyToCacheDirectory=true] - Whether to copy the file to cache directory (native only)
 * @param {boolean} [options.multiple=false] - Whether to allow multiple file selection
 * @returns {Promise<Object|null>} The picked document result or null if canceled
 */
const pickDocument = async (options: PickDocumentOptions = {}) => {
	const result = await DocumentPicker.getDocumentAsync({
		type: options.type || '*/*',
		copyToCacheDirectory: options.copyToCacheDirectory !== false,
		multiple: options.multiple || false,
	})

	if (result.canceled) {
		return null
	}

	return result.assets?.[0] || null
}

/**
 * Reads a file as text on web platform using FileReader
 * @param {Object} file - The file object to read
 * @returns {Promise<string>} Promise resolving to the file contents as string
 */
const readFileOnWeb = (file: any) => {
	if (!file) {
		throw new Error('No file object available on web')
	}

	return new Promise((resolve, reject) => {
		const reader = new FileReader()

		reader.onload = (e) => {
			if (e.target?.result && typeof e.target.result === 'string') {
				resolve(e.target.result)
			} else {
				reject(new Error('Failed to read file as text.'))
			}
		}

		reader.onerror = () => {
			reject(new Error('Error reading file: ' + reader.error))
		}

		reader.readAsText(file)
	})
}

/**
 * Reads a file as text on native platforms using FileSystem
 * @param {string} uri - The URI of the file to read
 * @returns {Promise<string>} Promise resolving to the file contents as string
 */
const readFileOnNative = async (uri: string) => {
	if (!uri) {
		throw new Error('No file URI available for native platform')
	}

	return FileSystem.readAsStringAsync(uri, {
		encoding: (FileSystem as any).EncodingType.UTF8,
	})
}

/**
 * Reads the content of a file based on platform
 * @param {Object} asset - The file asset object
 * @param {Object} [asset.file] - The file object (web)
 * @param {string} [asset.uri] - The file URI (native)
 * @returns {Promise<string>} Promise resolving to the file contents as string
 * @throws {Error} If no asset is provided
 */
const readFile = async (asset: any) => {
	if (!asset) {
		throw new Error('No asset provided')
	}

	if (Platform.OS === 'web') {
		return readFileOnWeb(asset.file)
	} else {
		return readFileOnNative(asset.uri)
	}
}

/**
 * Deletes a file
 * @param {string} uri - The URI of the file to delete
 * @returns {Promise<void>}
 */
const deleteFile = async (uri: string) => {
	if (!uri) {
		throw new Error('No file URI available for deletion')
	}

	try {
		await FileSystem.deleteAsync(uri)
	} catch (error) {
		console.error('Error deleting file:', error)
		throw error
	}
}

/**
 * Saves a string to a file or copies a file from source to destination
 * @param {string} filename - The name of the file or destination path
 * @param {string} content - The content to write or the source URI if copying a file
 * @param {Object} [options] - Additional options
 * @param {string} [options.mimeType='text/plain'] - The MIME type of the file
 * @param {boolean} [options.share=false] - Whether to share the file after saving (native only)
 * @param {string} [options.directory] - Subdirectory to save the file in (native only)
 * @param {boolean} [options.append=false] - Whether to append to an existing file
 * @param {boolean} [options.isCopyOperation=false] - If true, treats content as source URI to copy from
 * @returns {Promise<Object>} Object containing file URIs (uri, localUri)
 */
const saveFile = async (filename: string, content: string, options: SaveFileOptions = {}) => {
	const { mimeType = 'text/plain', share = false, directory = '', append = false } = options

	if (Platform.OS === 'web') {
		// On web, create a blob and trigger download

		const blob = new Blob([content], { type: mimeType })

		const url = URL.createObjectURL(blob)

		const a = document.createElement('a')
		a.href = url
		a.download = filename

		document.body.appendChild(a)
		a.click()

		document.body.removeChild(a)

		URL.revokeObjectURL(url)
		return { uri: url, localUri: url }
	} else {
		// On native, use FileSystem
		const dirPath = directory
			? `${(FileSystem as any).documentDirectory}${directory}/`
			: (FileSystem as any).documentDirectory

		// Ensure directory exists
		if (directory) {
			await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true })
		}

		const fileUri = `${dirPath}${filename}`

		try {
			if (append) {
				// For append functionality, read existing content and prepend it
				try {
					const existingContent = await FileSystem.readAsStringAsync(fileUri, {
						encoding: (FileSystem as any).EncodingType.UTF8,
					})
					await FileSystem.writeAsStringAsync(fileUri, existingContent + content, {
						encoding: (FileSystem as any).EncodingType.UTF8,
					})
				} catch {
					// File doesn't exist, just write new content
					await FileSystem.writeAsStringAsync(fileUri, content, {
						encoding: (FileSystem as any).EncodingType.UTF8,
					})
				}
			} else {
				await FileSystem.writeAsStringAsync(fileUri, content, {
					encoding: (FileSystem as any).EncodingType.UTF8,
				})
			}

			// Share the file if requested
			if (share) {
				await shareFile(fileUri, { mimeType })
			}

			return { uri: fileUri, localUri: fileUri }
		} catch (error) {
			console.error('Error saving file:', error)
			throw error
		}
	}
}

/**
 * Shares a file using expo-sharing
 * @param {string} fileUri - The URI of the file to share
 * @param {Object} [options] - Additional options
 * @param {string} [options.mimeType] - MIME type of the file (auto-detected if not provided)
 * @param {string} [options.dialogTitle] - Title for the share dialog
 * @returns {Promise}
 */
const shareFile = async (fileUri: string, options: ShareFileOptions = {}) => {
	if (Platform.OS === 'web') {
		// On web, we can't use the sharing API, so we'll just log the URI
		log.debug('Sharing file (web):', fileUri)
		return
	}

	try {
		// Check if sharing is available
		const isAvailable = await Sharing.isAvailableAsync()
		if (!isAvailable) {
			throw new Error('Sharing is not available on this device')
		}

		// Get file info
		const fileInfo = await FileSystem.getInfoAsync(fileUri)
		if (!fileInfo.exists) {
			throw new Error('File does not exist')
		}

		// Get MIME type if not provided
		let mimeType = options.mimeType
		if (!mimeType) {
			const extension = fileUri.split('.').pop()?.toLowerCase()
			mimeType = extension
				? MimeTypes.lookup(extension) || 'application/octet-stream'
				: 'application/octet-stream'
		}

		// Share the file
		await Sharing.shareAsync(fileUri, {
			mimeType,
			dialogTitle: options.dialogTitle || 'Share File',
			UTI: mimeType,
		})
	} catch (error) {
		console.error('Error sharing file:', error)
		throw error
	}
}

/**
 * Reads a directory
 * @param {string} dirUri - Directory URI to read
 * @returns {Promise<Array>} Array of file info objects
 */
const readDirectory = async (dirUri: string) => {
	if (Platform.OS === 'web') {
		throw new Error('readDirectory is not supported on web')
	}

	return FileSystem.readDirectoryAsync(dirUri)
}

/**
 * Gets information about a file or directory
 * @param {string} uri - File or directory URI
 * @returns {Promise<Object>} File info object
 */
const getInfo = async (uri: string) => {
	if (Platform.OS === 'web') {
		throw new Error('getInfo is not supported on web')
	}

	return FileSystem.getInfoAsync(uri)
}

// Export all utilities
/**
 * Locks the screen orientation to portrait up
 * @returns {Promise<void>}
 */
const lockScreenOrientation = async () => {
	if (Platform.OS === 'web') return
	const { lockAsync, OrientationLock } = await import('expo-screen-orientation')
	await lockAsync(OrientationLock.PORTRAIT_UP)
}

/**
 * Unlocks the screen orientation, allowing it to change based on device orientation
 * @returns {Promise<void>}
 */
const unlockScreenOrientation = async () => {
	if (Platform.OS === 'web') return
	const { unlockAsync } = await import('expo-screen-orientation')
	await unlockAsync()
}

export default {
	// Screen orientation
	lockScreenOrientation,
	unlockScreenOrientation,

	// Core functions
	pickDocument,
	readFile,
	saveFile,
	deleteFile,
	shareFile,

	// File system operations
	readDirectory,
	getInfo,

	// Constants
	documentDirectory: (FileSystem as any).documentDirectory,
	cacheDirectory: (FileSystem as any).cacheDirectory,

	// Platform-specific functions (use with caution)
	_platform: {
		readFileOnWeb,
		readFileOnNative,
		FileSystem: Platform.OS !== 'web' ? FileSystem : null,
	},

	// Re-export some commonly used FileSystem constants and methods
	EncodingType: (FileSystem as any).EncodingType,
}
