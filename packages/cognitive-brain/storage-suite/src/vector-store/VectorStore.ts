// Cross-platform entry point for VectorStore
// React Native automatically resolves:
// - VectorStore.native.ts on native platforms
// - VectorStore.web.ts on web platforms
import { Platform } from 'react-native'

// Import both classes
import { VectorStore as NativeVectorStore } from './VectorStore.native'
import { VectorStore as WebVectorStore } from './VectorStore.web'

// Export the appropriate class based on platform
export const VectorStore = Platform.OS === 'web' ? WebVectorStore : NativeVectorStore
