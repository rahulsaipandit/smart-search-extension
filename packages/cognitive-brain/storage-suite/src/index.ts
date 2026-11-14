/**
 * storage-suite - Main entry point
 * Provides storage utilities for React Native and Web platforms
 */

// Re-export storage modules
export { LocalStorage } from './storage/LocalStorage'
export { SecureStorage } from './storage/SecureStorage'
export { StorageManager, getDefaultStorageManager } from './storage/StorageManager'
export { getDatabase } from './storage/DatabaseManager'
export type { INamespacedFileStore } from './storage/NamespacedFileStore'
