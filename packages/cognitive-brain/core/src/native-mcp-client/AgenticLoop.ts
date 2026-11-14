/**
 * AgenticLoop - drives multi-step LLM ↔ tool execution.
 *
 * Algorithm:
 *   1. Inject available tools into the system prompt.
 *   2. Generate LLM response; stream tokens until a complete tool_call block
 *      is detected (tokens are withheld during the block).
 *   3. Parse the tool call; execute via MCPClientService.
 *   4. Inject the result as a synthetic user message and go to step 2.
 *   5. Stop when: no tool call detected (final answer) OR maxIterations reached.
 *   6. If maxIterations reached, ask the model to summarise its findings.
 *
 * Stateless: create one instance per app, call run() per message.
 *
 * Platforms: Web + Native.
 */
// GuideAxon change (TA-6): repeat detection.
import { buildToolSystemPrompt } from '../mcp/invocation/buildToolSystemPrompt'
import { hasPartialToolCall, parseToolCall, stripToolCall } from '../mcp/invocation/parseToolCall'
import { createLoopGuard } from './loopGuard'
import type {
	AgenticLoopOptions,
	AgenticLoopResult,
	AgenticToolEvent,
	ChatMessage,
	ILLMInference,
	MCPToolResult,
	ParsedToolCall,
	ResolvedTool,
	ToolCallFormat,
} from './types'

// IMCPClientService - only the subset AgenticLoop needs (avoids tight coupling)
export interface IToolExecutor {
	callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<MCPToolResult>
}

const DEFAULT_MAX_ITERATIONS = 5

export class AgenticLoop {
	constructor(
		private llm: ILLMInference,
		private executor: IToolExecutor,
		private format: ToolCallFormat = 'xml'
	) {}

	async run(
		messages: ChatMessage[],
		systemPrompt: string,
		tools: ResolvedTool[],
		opts: AgenticLoopOptions = {}
	): Promise<AgenticLoopResult> {
		const {
			maxIterations = DEFAULT_MAX_ITERATIONS,
			streamCallback,
			onToolCallStart,
			onToolCallEnd,
			signal,
			maxRepeats = 3,
		} = opts

		// Build the full system prompt with tool definitions appended
		const toolAddendum = buildToolSystemPrompt(tools, this.format)
		const fullSystem = [systemPrompt, toolAddendum].filter(Boolean).join('\n\n')

		const history: ChatMessage[] = [...messages]
		const toolEvents: AgenticToolEvent[] = []
		let iterations = 0
		let stoppedBy: AgenticLoopResult['stoppedBy']
		// maxRepeats 0 turns repeat detection off; the iteration cap below still applies.
		const guard = maxRepeats > 0 ? createLoopGuard({ maxRepeats }) : null

		while (iterations < maxIterations) {
			// GuideAxon change (TA-6): a stopped run starts no further generation and calls no further tool.
			if (signal?.aborted) return { answer: '', toolEvents, iterations, stoppedBy: 'aborted' }
			iterations++

			// ── Step 1: Generate ──────────────────────────────────────────────
			let rawResponse = ''
			let toolBlockStarted = false

			await this.llm.generateCompletion(
				[{ role: 'system', content: fullSystem }, ...history],
				{},
				(token: string) => {
					rawResponse += token

					// Suppress streaming once we see the start of a tool block
					if (hasPartialToolCall(rawResponse, this.format)) {
						toolBlockStarted = true
					}
					if (!toolBlockStarted) {
						streamCallback?.(token)
					}
				}
			)

			// The caller stopped while the model was generating: discard what came back, call nothing.
			if (signal?.aborted) return { answer: '', toolEvents, iterations, stoppedBy: 'aborted' }

			// ── Step 2: Check for tool call ───────────────────────────────────
			const toolCall = parseToolCall(rawResponse, this.format)

			if (!toolCall) {
				// No tool call → this is the final answer
				// If we suppressed tokens mid-stream (shouldn't happen for a final answer,
				// but guard anyway), emit the clean response now.
				if (toolBlockStarted) {
					streamCallback?.(rawResponse)
				}
				return { answer: rawResponse, toolEvents, iterations }
			}

			// GuideAxon change (TA-6): the same call again and again is a loop going nowhere. The call is NOT run;
			// the model is asked to answer with what it has (the same path as hitting the iteration cap).
			const verdict = guard?.record(toolCall.name, toolCall.arguments)
			if (verdict?.stop) {
				stoppedBy = verdict.reason === 'ping_pong' ? 'ping_pong' : 'repeated_call'
				break
			}

			// ── Step 3: Execute tool ──────────────────────────────────────────
			onToolCallStart?.(toolCall)

			const startMs = Date.now()
			let toolResult: MCPToolResult

			try {
				const serverId = this._resolveServerId(toolCall, tools)
				toolResult = await this.executor.callTool(serverId, toolCall.name, toolCall.arguments)
			} catch (err) {
				toolResult = {
					content: [{ type: 'text', text: `Tool execution error: ${String(err)}` }],
					isError: true,
				}
			}

			const event: AgenticToolEvent = {
				call: toolCall,
				result: toolResult,
				durationMs: Date.now() - startMs,
			}
			toolEvents.push(event)
			onToolCallEnd?.(event)

			// ── Step 4: Inject result into history ────────────────────────────
			history.push({ role: 'assistant', content: rawResponse })
			history.push({
				role: 'user',
				content: this._formatToolResult(toolCall, toolResult),
			})
		}

		// ── Max iterations hit (or a repeating loop): force final answer ───────
		let finalAnswer = ''
		const summaryPrompt: ChatMessage = {
			role: 'user',
			content: stoppedBy
				? 'You are repeating the same tool call. ' +
					'Please synthesise the information gathered so far and give your final answer without calling more tools.'
				: 'You have reached the maximum number of tool calls. ' +
					'Please synthesise the information gathered so far and give your final answer.',
		}

		await this.llm.generateCompletion(
			[{ role: 'system', content: fullSystem }, ...history, summaryPrompt],
			{},
			(token: string) => {
				finalAnswer += token
				streamCallback?.(token)
			}
		)

		if (signal?.aborted) return { answer: '', toolEvents, iterations, stoppedBy: 'aborted' }
		return { answer: finalAnswer, toolEvents, iterations, stoppedBy: stoppedBy ?? 'max_iterations' }
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Private
	// ─────────────────────────────────────────────────────────────────────────

	private _resolveServerId(toolCall: ParsedToolCall, tools: ResolvedTool[]): string {
		const match = tools.find((t) => t.name === toolCall.name)
		if (!match) {
			throw new Error(`AgenticLoop: tool "${toolCall.name}" not found in resolved tool list`)
		}
		return match.serverId
	}

	private _formatToolResult(toolCall: ParsedToolCall, result: MCPToolResult): string {
		const textContent = result.content
			.filter((c) => c.type === 'text')
			.map((c) => (c as { type: 'text'; text: string }).text)
			.join('\n')

		const hasError = result.isError ? ' (error)' : ''

		switch (this.format) {
			case 'xml':
				return `<tool_result name="${toolCall.name}"${hasError}>\n${textContent}\n</tool_result>`
			case 'hermes':
				return `<tool_response name="${toolCall.name}"${hasError}>\n${textContent}\n</tool_response>`
			case 'json-fence':
				return `Tool result for \`${toolCall.name}\`${hasError}:\n\`\`\`\n${textContent}\n\`\`\``
		}
	}
}
