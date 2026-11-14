import type { Skill } from './skill-types'

// RN/Hermes has no global `crypto` polyfill installed, so `crypto.randomUUID()`
// throws "Property 'crypto' doesn't exist" on native. Guard it the same way
// packages/cognitive-brain/memory/src/core/MemoryService.ts does.
function generateId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function exportSkillsToJSON(skills: Skill[]): string {
	return JSON.stringify(skills, null, 2)
}

export function importSkillsFromJSON(json: string): Skill[] {
	const parsed = JSON.parse(json)
	if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of skills')
	return parsed as Skill[]
}

// SKILL.md frontmatter follows the open Agent Skills standard's field
// allow-list (name, description, license, compatibility, allowed_tools,
// metadata — github.com/agentskills/agentskills). Only `name`/`description`
// are top-level; everything Quisya-specific (displayName, version, author,
// tags, scoreThreshold) lives under the standard's `metadata:` extension
// point instead of as ad-hoc top-level keys, which a standards-compliant
// validator would otherwise reject as "unexpected fields in frontmatter."
export function exportSkillToSKILLMD(skill: Skill): string {
	const frontmatter = [
		'---',
		`name: ${skill.name}`,
		`description: ${skill.description}`,
		'metadata:',
		`  display_name: ${skill.displayName}`,
		`  version: ${skill.version}`,
		`  author: ${skill.author}`,
		`  tags: [${skill.tags.join(', ')}]`,
		`  score_threshold: ${skill.scoreThreshold ?? 0.7}`,
		'---',
		'',
	].join('\n')
	return frontmatter + skill.instructionBody
}

export function importSkillFromSKILLMD(markdown: string, overrides: Partial<Skill> = {}): Skill {
	const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
	if (!fmMatch) throw new Error('No YAML frontmatter found')

	const fm = fmMatch[1]
	const body = markdown.slice(fmMatch[0].length).trim()

	// Top-level standard fields (name, description — zero indentation only, so
	// this never matches into the indented metadata: block below).
	const get = (key: string) => {
		const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm)
		return m ? m[1].trim() : ''
	}

	// Quisya-specific extension fields, nested under metadata: per the standard.
	const metadataMatch = /^metadata:\n((?:[ \t]+.+\n?)*)/m.exec(fm)
	const metadataBlock = metadataMatch ? metadataMatch[1] : ''
	const getMeta = (key: string) => {
		const m = new RegExp(`^[ \\t]+${key}:\\s*(.+)$`, 'm').exec(metadataBlock)
		return m ? m[1].trim() : ''
	}

	const tagsRaw = getMeta('tags').replace(/^\[|\]$/g, '')
	const tags = tagsRaw
		? tagsRaw
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		: []
	const scoreThreshold = parseFloat(getMeta('score_threshold')) || 0.7

	const now = Date.now()
	const name = get('name')
	const displayNameRaw = getMeta('display_name')
	return {
		id: generateId(),
		name,
		displayName: displayNameRaw || name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
		description: get('description'),
		tags,
		instructionBody: body,
		version: getMeta('version') || '1.0.0',
		author: getMeta('author') || 'imported',
		scoreThreshold,
		createdAt: now,
		updatedAt: now,
		isBuiltIn: false,
		...overrides,
	}
}
