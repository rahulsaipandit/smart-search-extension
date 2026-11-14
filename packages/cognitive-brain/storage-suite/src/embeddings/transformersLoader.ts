/**
 * How @huggingface/transformers reaches the web embedding service. The host registers a loader at startup, because
 * the right one depends on who builds the code:
 * - Chrome extension (Vite/WXT): register `() => import('@huggingface/transformers')`. The bundler packs the library,
 *   which Manifest V3 requires (its CSP forbids remote code).
 * - Website / Expo web (Metro): register `createCdnTransformersLoader(url)`. Metro follows every `import()` and cannot
 *   parse transformers' onnxruntime-web build, so this file must never import the package itself.
 */
export type TransformersLoader = () => Promise<any>

let loader: TransformersLoader | null = null

export function configureTransformersLoader(fn: TransformersLoader | null): void {
	loader = fn
}

/**
 * Loads the library from a URL at runtime. The `new Function` keeps the specifier out of the bundler's graph.
 * Never use this in the extension: Manifest V3 forbids remote code.
 *
 * The URL is spliced into code, so it is parsed and JSON-encoded here: only an absolute https URL is accepted and it
 * cannot close the string literal and run other code.
 */
export function createCdnTransformersLoader(url: string): TransformersLoader {
	const parsed = new URL(url)
	if (parsed.protocol !== 'https:') {
		throw new Error(`The transformers CDN URL must be https, got "${parsed.protocol}"`)
	}
	const specifier = JSON.stringify(parsed.href)
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- deliberate: a dynamic import() the bundler must not follow (see above)
	return () => new Function(`return import(${specifier})`)() as Promise<any>
}

export async function loadTransformers(): Promise<any> {
	if (!loader) {
		throw new Error(
			'No transformers loader registered. Call configureTransformersLoader() at startup ' +
				"(extension: () => import('@huggingface/transformers'); website: createCdnTransformersLoader(url))."
		)
	}
	return loader()
}
