/**
 * Ambient stand-ins for the React Native / Expo / on-device packages this suite imports.
 *
 * They are optional peer dependencies (see package.json): the mobile app installs the real ones and
 * type-checks against their real types, while this repo's web and extension builds never load them. These
 * declarations only let the suite type-check here, and type everything from those packages as `any`, so a
 * wrong call into them is NOT caught by this repo's typecheck. Delete an entry when the real package is added
 * as a devDependency.
 */
declare module 'react-native'
declare module 'react-native-mime-types'
declare module 'react-native-mmkv'
declare module '@react-native-async-storage/async-storage'
declare module '@op-engineering/op-sqlite' {
	export type DB = any
	export const open: any
}
declare module 'llama.rn'
declare module 'expo-document-picker'
declare module 'expo-file-system' {
	export class Directory {
		[member: string]: any
		constructor(...uris: any[])
	}
	export class File {
		[member: string]: any
		constructor(...uris: any[])
	}
	export const Paths: any
}
declare module 'expo-file-system/legacy'
declare module 'expo-screen-orientation'
declare module 'expo-secure-store'
declare module 'expo-sharing'
declare module 'expo-speech-recognition'
