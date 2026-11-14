export interface TextSplitter {
	splitText(text: string): Promise<string[]>
}

export class RecursiveTextSplitter implements TextSplitter {
	private chunkSize: number
	private chunkOverlap: number

	constructor(chunkSize: number = 512, chunkOverlap: number = 50) {
		this.chunkSize = chunkSize
		this.chunkOverlap = chunkOverlap
	}

	async splitText(text: string): Promise<string[]> {
		const chunks: string[] = []
		let start = 0

		while (start < text.length) {
			const end = Math.min(start + this.chunkSize, text.length)
			chunks.push(text.slice(start, end))
			start += this.chunkSize - this.chunkOverlap
		}

		return chunks
	}
}

export class SentenceTextSplitter implements TextSplitter {
	private maxChunkSize: number
	private overlap: number

	constructor(maxChunkSize: number = 512, overlap: number = 50) {
		this.maxChunkSize = maxChunkSize
		this.overlap = overlap
	}

	async splitText(text: string): Promise<string[]> {
		const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
		const chunks: string[] = []
		let currentChunk = ''

		for (const sentence of sentences) {
			if ((currentChunk + sentence).length > this.maxChunkSize && currentChunk.length > 0) {
				chunks.push(currentChunk.trim())
				currentChunk = sentence.slice(-this.overlap)
			} else {
				currentChunk += sentence
			}
		}

		if (currentChunk.trim()) {
			chunks.push(currentChunk.trim())
		}

		return chunks
	}
}
