/**
 * AgenticLoop: abort and repeat detection (TA-6). The loop had maxIterations only: no abort, no repeat detection.
 * A fake model scripts its replies; a fake executor counts the tools that actually run.
 */
import { AgenticLoop } from '../AgenticLoop'
import type { ILLMInference, ResolvedTool } from '../types'

const tool: ResolvedTool = {
	name: 'search',
	description: 'search the web',
	inputSchema: { type: 'object', properties: {} } as any,
	serverId: 's1',
	tier: 1,
}
const call = (name: string, args: Record<string, unknown>) =>
	`<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`

/** A model that returns the scripted replies in order, then the last one forever. */
function scriptedModel(replies: string[]): ILLMInference & { prompts: string[] } {
	const prompts: string[] = []
	let i = 0
	return {
		prompts,
		async generateCompletion(messages, _options, stream) {
			prompts.push(messages[messages.length - 1].content)
			const reply = replies[Math.min(i, replies.length - 1)]
			i += 1
			stream?.(reply)
			return reply
		},
	}
}

const executor = () => {
	const calls: { name: string; args: unknown }[] = []
	return {
		calls,
		callTool: async (_serverId: string, name: string, args: Record<string, unknown>) => {
			calls.push({ name, args })
			return { content: [{ type: 'text' as const, text: `result of ${name}` }] }
		},
	}
}

describe('AgenticLoop', () => {
	it('still answers normally: a tool call, then a final answer, with no stoppedBy', async () => {
		const ex = executor()
		const loop = new AgenticLoop(
			scriptedModel([call('search', { q: 'lisbon' }), 'Lisbon is lovely.']),
			ex
		)
		const result = await loop.run([{ role: 'user', content: 'tell me about Lisbon' }], 'sys', [
			tool,
		])
		expect(result).toMatchObject({ answer: 'Lisbon is lovely.', iterations: 2 })
		expect(result.stoppedBy).toBeUndefined()
		expect(ex.calls).toEqual([{ name: 'search', args: { q: 'lisbon' } }])
	})

	it('the same call again and again stops at the third: it is NOT run, and the model is asked to answer with what it has', async () => {
		const ex = executor()
		const model = scriptedModel([
			call('search', { q: 'x' }),
			call('search', { q: 'x' }),
			call('search', { q: 'x' }),
			'Here is what I found.',
		])
		const result = await new AgenticLoop(model, ex).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ maxIterations: 8 }
		)

		expect(result.stoppedBy).toBe('repeated_call')
		expect(result.answer).toBe('Here is what I found.')
		expect(ex.calls).toHaveLength(2) // the third identical call never ran
		expect(model.prompts[model.prompts.length - 1]).toMatch(/repeating the same tool call/)
	})

	it('a different argument is a different call', async () => {
		const ex = executor()
		const model = scriptedModel([
			call('search', { q: 'a' }),
			call('search', { q: 'b' }),
			call('search', { q: 'c' }),
			'done',
		])
		const result = await new AgenticLoop(model, ex).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ maxIterations: 8 }
		)
		expect(result.stoppedBy).toBeUndefined()
		expect(ex.calls).toHaveLength(3)
	})

	it('repeat detection can be turned off; the iteration cap still applies and is reported', async () => {
		const ex = executor()
		const model = scriptedModel([call('search', { q: 'x' })]) // calls the same tool forever
		const result = await new AgenticLoop(model, ex).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ maxRepeats: 0, maxIterations: 4 }
		)
		expect(result.stoppedBy).toBe('max_iterations')
		expect(ex.calls).toHaveLength(4) // nothing stopped the repeats; only the cap did
		expect(model.prompts[model.prompts.length - 1]).toMatch(/maximum number of tool calls/)
	})

	it('an abort before the first step does nothing at all', async () => {
		const ex = executor()
		const model = scriptedModel(['never asked'])
		const controller = new AbortController()
		controller.abort()
		const result = await new AgenticLoop(model, ex).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ signal: controller.signal }
		)
		expect(result).toMatchObject({ answer: '', stoppedBy: 'aborted', iterations: 0 })
		expect(model.prompts).toHaveLength(0)
		expect(ex.calls).toHaveLength(0)
	})

	it('an abort while the model is generating discards its reply and calls no tool', async () => {
		const ex = executor()
		const controller = new AbortController()
		const model: ILLMInference = {
			async generateCompletion(_m, _o, stream) {
				const reply = call('search', { q: 'x' })
				controller.abort() // the user pressed stop mid-generation
				stream?.(reply)
				return reply
			},
		}
		const result = await new AgenticLoop(model, ex).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ signal: controller.signal }
		)
		expect(result.stoppedBy).toBe('aborted')
		expect(result.answer).toBe('')
		expect(ex.calls).toHaveLength(0)
	})

	it('an abort between two tool calls stops before the next generation', async () => {
		const controller = new AbortController()
		const ex = executor()
		const stopAfterFirst = {
			callTool: async (s: string, n: string, a: Record<string, unknown>) => {
				const r = await ex.callTool(s, n, a)
				controller.abort()
				return r
			},
		}
		const model = scriptedModel([call('search', { q: 'a' }), call('search', { q: 'b' }), 'done'])
		const result = await new AgenticLoop(model, stopAfterFirst).run(
			[{ role: 'user', content: 'q' }],
			'sys',
			[tool],
			{ signal: controller.signal }
		)
		expect(result.stoppedBy).toBe('aborted')
		expect(model.prompts).toHaveLength(1)
		expect(result.toolEvents).toHaveLength(1)
	})
})
