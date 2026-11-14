/**
 * Namespaced file store contract.
 *
 * Files live under a namespace (slash-separated, e.g. 'skills/my-skill' or
 * 'widgets/<instance-id>') and may use sub-paths. Platform implementations:
 *   - web: OPFSStorage (OPFSStorage.web.ts, Origin Private File System)
 *   - native: not implemented yet; back it with expo-file-system (see utils/FileSystem.native.ts)
 *
 * Consumers should depend on this interface rather than a concrete class so that
 * skill and widget code stays portable.
 */
export interface INamespacedFileStore {
	/** Write a file; intermediate path segments are created automatically. */
	writeFile(namespace: string, path: string, content: Uint8Array | string): Promise<void>
	/** Read a file as raw bytes. */
	readFile(namespace: string, path: string): Promise<Uint8Array>
	/** Read a file as a UTF-8 string. */
	readFileAsText(namespace: string, path: string): Promise<string>
	/** List names of entries directly inside the namespace (or a sub-path within it). */
	listEntries(namespace: string, subPath?: string): Promise<string[]>
	/** Delete a file or directory (recursive). Missing entries are ignored. */
	deleteEntry(namespace: string, path: string): Promise<void>
	/** Delete the whole namespace and its contents. */
	deleteNamespace(namespace: string): Promise<void>
	/** Size and last-modified time (ms) of a file, or null if it does not exist. */
	getFileInfo(
		namespace: string,
		path: string
	): Promise<{ size: number; lastModified: number } | null>
	fileExists(namespace: string, path: string): Promise<boolean>
}
