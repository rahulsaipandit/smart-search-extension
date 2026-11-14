import { Platform } from 'react-native'

import { log } from './logger'

// Extend the Window interface to include Web Speech API
declare global {
	interface Window {
		SpeechRecognition?: any
		webkitSpeechRecognition?: any
	}
}

let isPolyfillInitialized = false

/**
 * Sets up the speech recognition support.
 * Prefers native Web Speech API when available, falls back to expo-speech-recognition.
 */
const setupSpeechPolyfill = () => {
	if (Platform.OS !== 'web') {
		log.debug('[SpeechPolyfill] Skipping (not on web)')
		return
	}

	if (isPolyfillInitialized) {
		log.debug('[SpeechPolyfill] Already initialized')
		return
	}

	isPolyfillInitialized = true
	// console.log("[SpeechPolyfill] Initializing Web Speech API support...");

	// Check if native Web Speech API is available
	if (
		typeof window !== 'undefined' &&
		(window.SpeechRecognition || window.webkitSpeechRecognition)
	) {
		log.debug('[SpeechPolyfill] Using native Web Speech API')
		return
	}

	// Fall back to expo-speech-recognition
	log.debug('[SpeechPolyfill] Native Web Speech API not found, loading polyfill...')
	import('expo-speech-recognition')
		.then(({ ExpoWebSpeechRecognition }) => {
			log.debug('[SpeechPolyfill] Setting up polyfill')
			if (typeof window !== 'undefined') {
				window.SpeechRecognition = ExpoWebSpeechRecognition
				window.webkitSpeechRecognition = ExpoWebSpeechRecognition
			}
			log.debug('[SpeechPolyfill] Polyfill initialized')
		})
		.catch(console.error)
}

export default setupSpeechPolyfill
