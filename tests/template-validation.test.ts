import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../src/templates/validation';

describe('template validation', () => {
	it('accepts supported variables and nested conditionals', () => {
		expect(validateTemplate('{{word}}\n{{#if IPA}}{{IPA}}{{/if}}\n{{#if translationsMarkdown}}ok{{/if}}')).toEqual([]);
	});

	it('reports unknown variables and malformed conditionals', () => {
		const issues = validateTemplate('{{word}} {{notARealVariable}} {{#if IPA}}missing close');

		expect(issues.map((issue) => issue.kind)).toEqual(['unknown-variable', 'unclosed-conditional']);
		expect(issues[0]?.message).toContain('notARealVariable');
	});

	it('reports an unexpected conditional close', () => {
		const issues = validateTemplate('text {{/if}}');

		expect(issues).toHaveLength(1);
		expect(issues[0]?.kind).toBe('unexpected-conditional-close');
	});
});
