/**
 * The page-control contract PageAgentCore depends on.
 *
 * Core is platform-neutral, so it owns this interface instead of importing a concrete
 * controller. `@page-agent/page-controller` (DOM) implements it structurally, and a
 * WebView- or accessibility-based controller can do the same on Android. Passing a
 * controller that no longer satisfies the contract is a compile error at the call site
 * that builds the agent config.
 */

/** Outcome of one page action; `message` is shown to the LLM. */
export interface ActionResult {
	success: boolean
	message: string
}

/** Snapshot of the page that is dehydrated into the LLM prompt. */
export interface BrowserState {
	url: string
	title: string
	/** Page info + scroll position hint (e.g. "Page info: 1920x1080px...\n[Start of page]") */
	header: string
	/** Simplified HTML of interactive elements */
	content: string
	/** Page footer hint (e.g. "... 300 pixels below ..." or "[End of page]") */
	footer: string
}

export interface IPageController {
	getLastUpdateTime(): Promise<number>
	getBrowserState(): Promise<BrowserState>
	/** Rebuild the element index; returns the simplified page HTML. */
	updateTree(): Promise<string>
	cleanUpHighlights(): Promise<void>

	clickElement(index: number): Promise<ActionResult>
	inputText(index: number, text: string): Promise<ActionResult>
	selectOption(index: number, optionText: string): Promise<ActionResult>
	getFormFields(includeAllForms?: boolean): Promise<ActionResult>
	scroll(options: {
		down: boolean
		numPages: number
		pixels?: number
		index?: number
	}): Promise<ActionResult>
	scrollHorizontally(options: {
		right: boolean
		pixels: number
		index?: number
	}): Promise<ActionResult>
	executeJavascript(script: string, signal?: AbortSignal): Promise<ActionResult>

	showMask(): Promise<void>
	hideMask(): Promise<void>
	dispose(): void
}
