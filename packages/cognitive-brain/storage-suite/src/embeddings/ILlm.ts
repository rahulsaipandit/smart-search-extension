// src/embeddings/ILlm.ts
// Keep: GuideAxon's ChatModeOrchestrator.native.ts imports this type; nothing in this repo does.

export interface ILlm {
	load(): Promise<this>
	interrupt(): Promise<void>
	unload(): Promise<void>
	generate(
		messages: { role: string; content: string }[],
		onToken: (token: string) => void
	): Promise<string>
}
