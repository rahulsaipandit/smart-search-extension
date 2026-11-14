export function normalizeTransformerOutput(output: any): number[] {
	try {
		if (!output) return []
		const roundArray = (arr: number[]) =>
			arr.map((x) => (typeof x === 'number' ? Number(x.toFixed(6)) : x))

		// If output has .data
		if (output.data) {
			const data = output.data
			if (Array.isArray(data)) return roundArray(data as number[])
			if (data instanceof Float32Array || data instanceof Float64Array)
				return roundArray(Array.from(data as any))
			if (ArrayBuffer.isView(data)) {
				try {
					const view = data as ArrayBufferView
					const byteLength = (view as any).byteLength || 0
					const length = byteLength ? byteLength / 4 : undefined
					return roundArray(
						Array.from(new Float32Array(view.buffer, (view as any).byteOffset || 0, length))
					)
				} catch {
					// fallthrough
				}
			}
			try {
				if (data && typeof data.byteLength === 'number') {
					return roundArray(Array.from(new Float32Array(data)))
				}
			} catch {
				// fallthrough
			}
		}

		// Nested arrays e.g. [ [values] ]
		if (Array.isArray(output) && output.length === 1 && Array.isArray(output[0])) return output[0]

		// Direct array or nested arrays: flatten and return
		if (Array.isArray(output)) {
			const flat = output.flat(Infinity)
			return flat.some((x) => typeof x === 'number') ? (flat as number[]) : []
		}

		// handle objects with embeddings property
		if (output.embeddings && Array.isArray(output.embeddings)) {
			// choose first embedding
			const first = output.embeddings[0]
			if (Array.isArray(first)) return first as number[]
			if (first instanceof Float32Array) return Array.from(first)
		}

		// If nothing matched, warn and return empty array
		console.warn('Unrecognized transformers output format in normalizeTransformerOutput', output)
		return []
	} catch (error) {
		console.error('Error normalizing transformer output', error)
		return []
	}
}
