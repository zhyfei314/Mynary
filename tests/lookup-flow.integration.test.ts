/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WiktionaryProvider, WiktionaryHttpResponse } from '../src/providers/wiktionary';
import { CacheManager } from '../src/services/cache';
import { renderTemplate } from '../src/templates/renderer';
import { createVocabularyNoteInVault } from '../src/templates/note-generator';
import type { DictionarySettings } from '../src/settings';

function fixture(name: string) {
	return readFileSync(`tests/fixtures/${name}`, 'utf8');
}

function settings(): DictionarySettings {
	return {
		defaultLanguage: 'en', languages: [], noteFolder: 'Vocabulary', filenameTemplate: '{{word}}', cacheTtlDays: 7,
		maxCacheEntries: 100, defaultTemplateId: 'integration', templates: [{ id: 'integration', name: 'Integration', content: '# {{word}}\n\n{{meaningsMarkdown}}\n\n{{#if examplesMarkdown}}## Examples\n{{examplesMarkdown}}\n{{/if}}' }], existingNoteBehavior: 'ask', ttsEnabled: false, ttsAutoGenerate: false, ttsRuntime: 'web', supertonicEndpoint: 'http://127.0.0.1:7788/v1/tts', supertonicVoice: 'M1', supertonicSteps: 8, supertonicSpeed: 1.05,
	};
}

function page(title: string, html: string): WiktionaryHttpResponse {
	return { status: 200, json: { parse: { title, text: { '*': html } } } };
}

function fakePlugin(initial: Record<string, unknown> = {}) {
	let data = initial;
	return {
		loadData: async () => data,
		saveData: async (next: Record<string, unknown>) => { data = next; },
	};
}

describe('lookup flow integration', () => {
	it('looks up, caches, renders and creates a vocabulary note', async () => {
		const config = settings();
		const storage = fakePlugin();
		const cache = new CacheManager(storage as never, config);
		let requests = 0;
		const provider = new WiktionaryProvider(async () => {
			requests += 1;
			return page('hello', fixture('hello.html'));
		});
		const lookup = async () => {
			const key = 'v5:en:hello';
			const cached = await cache.get(key);
			if (cached) return cached;
			const entry = await provider.lookup('hello', 'en');
			await cache.set(key, entry);
			return entry;
		};

		const first = await lookup();
		const rendered = renderTemplate(first, config.templates[0]!.content);
		const created: Array<{ path: string; content: string }> = [];
		const vault = {
			getAbstractFileByPath: () => null,
			createFolder: async () => undefined,
			create: async (path: string, content: string) => { created.push({ path, content }); return { path }; },
			read: async () => '',
			modify: async () => undefined,
		};
		await createVocabularyNoteInVault(vault, first, config);
		const second = await lookup();

		expect(requests).toBe(1);
		expect(second).toEqual(first);
		expect(rendered).toContain('# hello');
		expect(rendered).toContain('A greeting said when meeting someone.');
		expect(created).toEqual([{ path: 'Vocabulary/hello.md', content: rendered }]);
	});
});
