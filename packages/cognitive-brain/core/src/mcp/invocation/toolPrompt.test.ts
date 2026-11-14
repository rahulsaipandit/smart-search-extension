import { describe, expect, it } from 'vitest'

import type { ToolCallFormat } from '../types'
import { buildToolSystemPrompt } from './buildToolSystemPrompt'
import { hasPartialToolCall, parseToolCall, stripToolCall } from './parseToolCall'

const tools = [
	{
		name: 'search',
		description: 'Search the web',
		inputSchema: { type: 'object' as const, properties: { q: { type: 'string' as const } } },
	},
]

describe('buildToolSystemPrompt', () => {
	it('is empty when there are no tools, so no prompt noise is injected', () => {
		expect(buildToolSystemPrompt([])).toBe('')
	})

	it('lists the tools with their JSON schema and the format the parser expects', () => {
		const xml = buildToolSystemPrompt(tools, 'xml')
		expect(xml).toContain('"name": "search"')
		expect(xml).toContain('<tool_call>')
		expect(buildToolSystemPrompt(tools, 'json-fence')).toContain('"tool": "<tool_name>"')
	})
})

describe('parseToolCall', () => {
	it.each<[ToolCallFormat, string]>([
		['xml', 'Let me check.\n<tool_call>\n{"name":"search","arguments":{"q":"cats"}}\n</tool_call>'],
		['hermes', '<tool_call>{"name":"search","arguments":{"q":"cats"}}</tool_call>'],
		['json-fence', 'Calling:\n```json\n{"tool":"search","arguments":{"q":"cats"}}\n```'],
	])('extracts name and arguments in %s format', (format, text) => {
		const call = parseToolCall(text, format)
		expect(call?.name).toBe('search')
		expect(call?.arguments).toEqual({ q: 'cats' })
	})

	it('treats text without a tool block as a final answer', () => {
		expect(parseToolCall('The answer is 42.')).toBeNull()
	})

	it('returns null instead of throwing on malformed or nameless blocks', () => {
		expect(parseToolCall('<tool_call>{oops</tool_call>')).toBeNull()
		expect(parseToolCall('<tool_call>{"arguments":{}}</tool_call>')).toBeNull()
	})

	it('recovers a block whose JSON the model wrapped across lines', () => {
		const text = '<tool_call>{"name":"search",\n   "arguments":{"q":"a b"}}</tool_call>'
		expect(parseToolCall(text)?.arguments).toEqual({ q: 'a b' })
	})
})

describe('streaming helpers', () => {
	it('holds back streaming only while a tool block is still open', () => {
		expect(hasPartialToolCall('thinking <tool_call>{"na')).toBe(true)
		expect(hasPartialToolCall('<tool_call>{}</tool_call>')).toBe(false)
		expect(hasPartialToolCall('```json\n{"tool"', 'json-fence')).toBe(true)
		expect(hasPartialToolCall('```json\n{}\n```', 'json-fence')).toBe(false)
	})

	it('strips the block so only the prose is shown', () => {
		const text = 'Looking it up.\n<tool_call>{"name":"search","arguments":{}}</tool_call>'
		expect(stripToolCall(text)).toBe('Looking it up.')
	})
})
