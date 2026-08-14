export interface TemplateValidationIssue {
	kind: 'unknown-variable' | 'unclosed-conditional' | 'unexpected-conditional-close' | 'invalid-conditional';
	message: string;
	position: number;
}

const VALID_VARIABLES = new Set([
	'word', 'title', 'language', 'definition', 'definitions', 'definitionsmarkdown', 'meaningsmarkdown',
	'ipa', 'partofspeech', 'example', 'examples', 'examplesmarkdown', 'translation', 'translations',
	'translationsmarkdown', 'synonyms', 'antonyms', 'etymology', 'source', 'sourceurl', 'lookupdate',
	'source_url', 'lookup_date', 'definitions_markdown', 'examples_markdown', 'translations_markdown', 'meanings_markdown',
]);

export function validateTemplate(template: string): TemplateValidationIssue[] {
	const issues: TemplateValidationIssue[] = [];
	const conditionals: Array<{ key: string; position: number }> = [];
	const tokens = /\{\{\s*(#if|\/if|[\w]+)?(?:\s+([\w]+))?\s*\}\}/gi;
	let match: RegExpExecArray | null;

	while ((match = tokens.exec(template))) {
		const tokenType = match[1]?.toLocaleLowerCase();
		if (tokenType === '#if') {
			const key = match[2] ?? '';
			if (!key || !isKnownVariable(key)) {
				issues.push({ kind: 'invalid-conditional', message: key ? `Unknown conditional variable “${key}”.` : 'Conditional blocks need a variable name.', position: match.index });
			} else {
				conditionals.push({ key, position: match.index });
			}
			continue;
		}
		if (tokenType === '/if') {
			if (!conditionals.length) issues.push({ kind: 'unexpected-conditional-close', message: 'Unexpected {{/if}}.', position: match.index });
			else conditionals.pop();
			continue;
		}

		const key = match[1] ?? '';
		if (key && !isKnownVariable(key)) issues.push({ kind: 'unknown-variable', message: `Unknown variable “${key}”.`, position: match.index });
	}

	conditionals.forEach((conditional) => issues.push({ kind: 'unclosed-conditional', message: `Missing {{/if}} for “${conditional.key}”.`, position: conditional.position }));
	return issues;
}

export function isKnownTemplateVariable(variable: string): boolean {
	return isKnownVariable(variable);
}

function isKnownVariable(variable: string) {
	return VALID_VARIABLES.has(variable.toLocaleLowerCase());
}
