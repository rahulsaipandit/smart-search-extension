/**
 * This is the main entry point for the storage module.
 * It re-exports the shared interfaces and types from `StorageManager.ts`.
 * It also exports the appropriate platform-specific storage factory
 * (either `NativeStorageFactory` or `WebStorageFactory`) as the default export,
 * leveraging Metro's and other bundlers' platform resolution capabilities.
 */
// Re-export all shared types and interfaces from the main module.
// Import the platform-specific factory. The bundler will resolve this to
// `./StorageManager.native.ts` or `./StorageManager.web.ts` automatically.
import StorageFactory from './StorageManager'

export * from './StorageManager'

// Export the factory as the default export for this module.
export default StorageFactory
