/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { WiktionaryProvider, WiktionaryHttpResponse } from '../src/providers/wiktionary';
import { readFileSync } from 'node:fs';

function fixture(name: string) {
	return readFileSync(`tests/fixtures/${name}`, 'utf8');
}

function page(title: string, html: string): WiktionaryHttpResponse {
	return { status: 200, json: { parse: { title, text: { '*': html } } } };
}

const mainWithTranslationLink = '<h2>English</h2><h3>Etymology 1</h3><h4>Noun</h4><ol><li>Affection.</li></ol><h4>Translations</h4><p>See <a href="/wiki/love/translations#Noun">love/translations § Noun</a>.</p>';
const translationPage = '<h2>English</h2><h3>Noun</h3><h4>Translations</h4><h5>strong affection</h5><ul><li><a lang="vi">Vietnamese</a>: <a>tình yêu</a></li><li><a lang="ja">Japanese</a>: <a>愛</a></li></ul>';
const ipaOnlyPage = '<h2>English</h2><h3>Pronunciation</h3><ul><li><span class="IPA">/hɛˈloʊ/</span></li></ul><h3>Noun</h3><ol><li>A greeting.</li></ol>';
const inflectedPage = '<h2>English</h2><h3>Verb</h3><p>simple past and past participle of walk</p>';
const lemmaPage = '<h2>English</h2><h3>Verb</h3><ol><li>To move by placing one foot in front of the other.</li></ol>';

describe('Wiktionary provider integration', () => {
	it('fails with a timeout when Wiktionary does not respond', async () => {
		vi.useFakeTimers();
		try {
			const provider = new WiktionaryProvider(() => new Promise<never>(() => undefined));
			const lookup = provider.lookup('love', 'en');
			const rejection = expect(lookup).rejects.toThrow('timed out after 15 seconds');
			await vi.advanceTimersByTimeAsync(15_000);
			await rejection;
		} finally {
			vi.useRealTimers();
		}
	});

	it('merges translations fetched from the dedicated subpage', async () => {
		const responses = [page('love', mainWithTranslationLink), page('love/translations', translationPage)];
		const urls: string[] = [];
		const provider = new WiktionaryProvider(async (url) => { urls.push(url); return responses.shift() ?? { status: 404, json: {} }; });

		const entry = await provider.lookup('love', 'en');

		expect(urls).toHaveLength(2);
		expect(urls[1]).toContain('love%2Ftranslations');
		expect(entry.meanings[0]?.etymology).toBe('Etymology 1');
		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'tình yêu', sense: 'strong affection' });
		expect(entry.translations).toContainEqual({ languageCode: 'ja', languageName: 'Japanese', word: '愛', sense: 'strong affection' });
	});

	it('keeps the main entry when the translation subpage is rate-limited', async () => {
		let call = 0;
		const provider = new WiktionaryProvider(async () => {
			call += 1;
			if (call === 1) return page('love', mainWithTranslationLink);
			throw new Error('429 Too Many Requests');
		});

		const entry = await provider.lookup('love', 'en');

		expect(call).toBe(2);
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('Affection.');
		expect(entry.translations).toEqual([]);
	});

	it('merges a real multi-etymology entry with its translation subpage', async () => {
		const responses = [page('bank', fixture('bank-real-en.html')), page('bank/translations', fixture('bank-translations-real-en.html'))];
		const provider = new WiktionaryProvider(async () => responses.shift() ?? { status: 404, json: {} });

		const entry = await provider.lookup('bank', 'en');

		expect(entry.meanings.map((meaning) => meaning.etymology)).toEqual(['Etymology 1', 'Etymology 2']);
		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'ngân hàng', sense: 'financial institution' });
		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'gửi tiền', sense: 'deposit money' });
	});

	it('resolves lowercase titles and reports a missing entry', async () => {
		const responses = [
			{ status: 200, json: {} },
			page('hello', '<h2>English</h2><h3>Interjection</h3><ol><li>A greeting.</li></ol>'),
		];
		const entry = await new WiktionaryProvider(async () => responses.shift() ?? { status: 404, json: {} }).lookup('Hello', 'en');
		expect(entry.word).toBe('Hello');
		expect(entry.source.url).toBe('https://en.wiktionary.org/wiki/hello');

		const missing = new WiktionaryProvider(async (url) => url.includes('list=search') ? { status: 200, json: { query: { search: [] } } } : { status: 200, json: {} });
		await expect(missing.lookup('not-a-real-word', 'en')).rejects.toThrow('No entry found');
	});

	it('resolves an English inflected page to a lemma when it has no meanings', async () => {
		const responses = [page('walked', inflectedPage), page('walked/translations', ''), page('walk', lemmaPage), page('walk/translations', '')];
		const provider = new WiktionaryProvider(async () => responses.shift() ?? { status: 404, json: {} });

		const entry = await provider.lookup('walked', 'en');

		expect(entry.word).toBe('walked');
		expect(entry.baseWord).toBe('walk');
		expect(entry.inflection).toBe('past tense');
		expect(entry.meanings[0]?.definitions[0]?.text).toContain('move by placing');
	});

	it('adds Supertonic as a secondary track only when auto-generation is enabled', async () => {
		const synthesize = vi.fn(async () => ({ url: 'blob:tts', provider: 'tts' as const, mimeType: 'audio/wav' }));
		const tts = { synthesize } as never;
		const provider = new WiktionaryProvider(async () => page('hello', ipaOnlyPage), tts, true);

		const entry = await provider.lookup('hello', 'en');

		expect(synthesize).toHaveBeenCalledWith('hello', 'en');
		expect(entry.phonetics[0]?.audio).toEqual([{ url: 'blob:tts', provider: 'tts', mimeType: 'audio/wav' }]);
	});
});
