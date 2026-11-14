// Define the storage key type for better type safety
export type StorageKey = keyof typeof _Storage

// Define the storage value type
export type StorageValue = (typeof _Storage)[StorageKey]

const _Storage = {
	API: 'api-storage',
	EngineData: 'enginedata-storage',
	KV: 'kvdata-storage',
	TextFilter: 'textfilter-storage',
	AppMode: 'appmode-storage',
	BackgroundImage: 'background-image-storage',
	UserCard: 'usercard-storage',
	Instruct: 'instruct-storage',
	Logs: 'logstate-storage',
	Samplers: 'samplerstate-storage',
	TTS: 'tts-data-storage',
	ColorState: 'colorscheme-storage',
	TagHider: 'tag-hider-storage',
	CharacterSearch: 'storage-character-search',
	// Character system storage keys
	CharacterData: 'character-data-storage',
	CurrentCharacter: 'current-character-storage',
	CharacterState: 'character-state-storage',
	UserData: 'user-data-storage',
	CurrentUser: 'current-user-storage',
	UserState: 'user-state-storage',
	CharacterChats: 'character-chats-storage',
} as const

// Build reverse lookup
const _StorageMutable = _Storage as Record<string, string>
for (const [key, value] of Object.entries(_Storage)) {
	_StorageMutable[value] = key
}

export const StorageEnums = Object.freeze(_StorageMutable)
