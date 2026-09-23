import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { normalizeEntry, parseWiktionaryHtml } from '../src/providers/wiktionary-html-parser';

function fixture(name: string) {
	return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('rendered Wiktionary HTML parser', () => {
	it('extracts clean meanings, IPA, etymology and grouped translations from hello', () => {
		const html = fixture('hello.html');
		const entry = parseWiktionaryHtml(html, 'hello', 'en', 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings.map((meaning) => meaning.partOfSpeech)).toEqual(['Interjection', 'Noun']);
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A greeting said when meeting someone.');
		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['Hello, everyone.']);
		expect(entry.phonetics).toEqual([{ text: '/hɛˈloʊ/' }, { text: '/həˈləʊ/' }]);
		expect(entry.etymology).toContain('First attested in 1826.');
		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'xin chào', sense: 'greeting' });
		expect(entry.translations).toContainEqual({ languageCode: 'fr', languageName: 'French', word: 'bonjour', sense: 'greeting' });
		expect(entry.meanings.some((meaning) => meaning.definitions.some((definition) => definition.text.includes('French entry')))).toBe(false);
	});

	it('removes repeated language tokens and quote-only examples', () => {
		const entry = normalizeEntry({
			word: 'small', language: 'en', phonetics: [],
			meanings: [{ partOfSpeech: 'Adjective', definitions: [{ text: 'Not large.', examples: ['Quote: en en en', 'A normal example.'] }] }],
			translations: [{ word: 'en en en', languageCode: 'en', languageName: 'English' }, { word: 'small', languageCode: 'vi', languageName: 'Vietnamese' }],
			synonyms: [], antonyms: [], source: { id: 'test', name: 'Test', url: 'https://example.com' }, fetchedAt: 1700000000000,
		});

		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['A normal example.']);
		expect(entry.translations).toContainEqual({ word: 'small', languageCode: 'vi', languageName: 'Vietnamese', sense: undefined });
	});

	it('supports the current Wiktionary heading wrapper structure', () => {
		const html = '<div class="mw-parser-output"><div class="mw-heading mw-heading2"><h2>English</h2></div><div class="mw-heading mw-heading3"><h3>Noun</h3></div><ol><li>A greeting.</li></ol></div>';
		const entry = parseWiktionaryHtml(html, 'hello', 'en', 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings[0]?.partOfSpeech).toBe('Noun');
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A greeting.');
	});

	it.each([
		['vi', 'Tiếng Việt'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '汉语'],
		['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['ru', 'Русский'],
	])('finds the localized language section for %s', (language, heading) => {
		const html = `<div class="mw-parser-output"><div class="mw-heading mw-heading2"><h2>${heading}</h2></div><div class="mw-heading mw-heading3"><h3>Noun</h3></div><ol><li>A localized definition.</li></ol></div>`;
		const entry = parseWiktionaryHtml(html, 'sample', language, 'sample', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A localized definition.');
	});

	it('recognizes localized translation headings', () => {
		const html = '<div class="mw-parser-output"><h2>Français</h2><h3>Interjection</h3><ol><li>A greeting.</li></ol><h4>Traductions</h4><h5>greeting</h5><table><tr><th><a lang="en">English</a></th><td><a href="/wiki/hello">hello</a></td></tr></table></div>';
		const entry = parseWiktionaryHtml(html, 'bonjour', 'fr', 'bonjour', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.translations).toContainEqual({ languageCode: 'en', languageName: 'English', word: 'hello', sense: 'greeting' });
	});

	it('supports single-section pages with a disambiguated h2', () => {
		const html = '<div class="mw-parser-output"><h2>hello (Englisch)</h2><h3>Interjektion</h3><ol><li>Ein Gruß.</li></ol></div>';
		const entry = parseWiktionaryHtml(html, 'hello', 'de', 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings[0]?.partOfSpeech).toBe('Interjektion');
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('Ein Gruß.');
	});

	it('keeps etymology headings when the same part of speech is split', () => {
		const html = '<div class="mw-parser-output"><h2>English</h2><h3>Etymology 1</h3><h4>Noun</h4><ol><li>Affection.</li></ol><h3>Etymology 2</h3><h4>Noun</h4><ol><li>A score of zero.</li></ol></div>';
		const entry = parseWiktionaryHtml(html, 'love', 'en', 'love', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings.map((meaning) => [meaning.partOfSpeech, meaning.etymology])).toEqual([['Noun', 'Etymology 1'], ['Noun', 'Etymology 2']]);
	});

	it('keeps multiple real etymology groups in one language section', () => {
		const entry = parseWiktionaryHtml(fixture('bank-real-en.html'), 'bank', 'en', 'bank', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings.map((meaning) => [meaning.partOfSpeech, meaning.etymology])).toEqual([
			['Noun', 'Etymology 1'], ['Verb', 'Etymology 2'],
		]);
		expect(entry.meanings[0]?.definitions).toHaveLength(2);
	});

	it('returns optional empty fields for a page without definitions', () => {
		const entry = parseWiktionaryHtml(fixture('pronunciation-only-en.html'), 'context', 'en', 'context', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings).toEqual([]);
		expect(entry.phonetics).toEqual([{ text: '/ˈkɒn.tɛkst/' }]);
	});

	it('preserves Wiktionary form-of text and its link target', () => {
		const html = '<h2>English</h2><h3>Verb</h3><ol><li>third-person singular simple present indicative of <a href="/wiki/destroy">destroy</a></li></ol>';
		const entry = parseWiktionaryHtml(html, 'destroys', 'en', 'destroys', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings[0]?.definitions[0]?.text).toBe('third-person singular simple present indicative of destroy');
		expect(entry.meanings[0]?.definitions[0]?.links).toEqual([{ text: 'destroy', target: 'destroy', url: 'https://en.wiktionary.org/wiki/destroy' }]);
	});

	it('keeps an entry definition alongside a Wiktionary form-of definition', () => {
		const html = '<h2>English</h2><h3>Noun</h3><ol><li>plural of <a href="/wiki/run">run</a></li></ol><h3>Noun</h3><ol><li>Diarrhea.</li></ol>';
		const entry = parseWiktionaryHtml(html, 'runs', 'en', 'runs', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text))).toEqual(['plural of run', 'Diarrhea.']);
		expect(entry.meanings[0]?.definitions[0]?.links?.[0]?.target).toBe('run');
	});

	it('parses translation subpages and keeps sense groups', () => {
		const html = fixture('love-translations.html');
		const entry = parseWiktionaryHtml(html, 'love', 'en', 'love', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'tình yêu', sense: 'strong affection' });
		expect(entry.translations).toContainEqual({ languageCode: 'vi', languageName: 'Vietnamese', word: 'yêu', sense: 'to have strong affection' });
	});

	it('parses relay-style multiple etymologies and does not leak stylesheet text', () => {
		const html = `<div class="mw-parser-output"><style>.mw-parser-output .defdate{font-size:85%}</style>
			<h2>English</h2><h3>Etymology 1</h3><p>From an older word.</p><h4> Noun </h4>
			<ol><li>A new set of hounds. <span class="defdate">[from 15th c.]</span></li></ol>
			<h4>Translations</h4><div class="translations"><h5>new set of anything</h5><table><tr><th><a lang="bg">Bulgarian</a></th><td><a href="/wiki/smjana">смяна</a> f</td></tr></table></div>
			<h3>Etymology 2</h3><p>From another source.</p><h4>Verb</h4><ol><li>To pass on information.</li></ol>
			<h4>Translations</h4><div class="translations"><h5>to pass on</h5><ul><li><a lang="fr">French</a>: <a href="/wiki/transmettre">transmettre</a></li></ul></div></div>`;
		const entry = parseWiktionaryHtml(html, 'relay', 'en', 'relay', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings.map((meaning) => [meaning.partOfSpeech, meaning.etymology])).toEqual([
			['Noun', 'Etymology 1'], ['Verb', 'Etymology 2'],
		]);
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A new set of hounds. [from 15th c.]');
		expect(entry.meanings[0]?.definitions[0]?.text).not.toContain('.mw-parser-output');
		expect(entry.translations).toContainEqual({ languageCode: 'bg', languageName: 'Bulgarian', word: 'смяна', sense: 'new set of anything' });
		expect(entry.translations).toContainEqual({ languageCode: 'fr', languageName: 'French', word: 'transmettre', sense: 'to pass on' });
	});

	it('normalizes pronunciation audio sources into separate objects', () => {
		const html = `<div class="mw-parser-output"><h2>English</h2><h3>Pronunciation</h3><ul><li><span class="IPA">/hɛˈloʊ/</span><audio data-mwprovider="wikimediacommons" data-mwtitle="Example.wav"><source src="//upload.wikimedia.org/audio.ogg" type="audio/ogg"><source src="/audio.mp3" type="audio/mpeg"></audio></li></ul><h3>Interjection</h3><ol><li>A greeting.</li></ol></div>`;
		const entry = parseWiktionaryHtml(html, 'hello', 'en', 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.phonetics).toEqual([{
			text: '/hɛˈloʊ/',
			audio: [
				{ url: 'https://upload.wikimedia.org/audio.ogg', mimeType: 'audio/ogg', title: 'Example.wav', provider: 'wikimedia-commons' },
				{ url: 'https://en.wiktionary.org/audio.mp3', mimeType: 'audio/mpeg', title: 'Example.wav', provider: 'wikimedia-commons' },
			],
		}]);
	});

	it('associates an audio table placed after an IPA list item with that IPA', () => {
		const html = `<div class="mw-parser-output"><h2>English</h2><h3>Pronunciation</h3><ul><li><span class="usage-label-accent">Received Pronunciation</span> <span class="IPA">/həˈləʊ/</span></li><li>Rhymes: -əʊ</li></ul><table class="audiotable"><tr><td>Audio (UK): <audio data-mwprovider="wikimediacommons"><source src="//upload.wikimedia.org/hello.ogg" type="audio/ogg"></audio></td></tr></table></div>`;
		const entry = parseWiktionaryHtml(html, 'hello', 'en', 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.phonetics).toEqual([{
			text: '/həˈləʊ/',
			audio: [{ url: 'https://upload.wikimedia.org/hello.ogg', mimeType: 'audio/ogg', provider: 'wikimedia-commons' }],
		}]);
	});

	it('keeps IPA-only pronunciations without creating an audio source', () => {
		const html = '<div class="mw-parser-output"><h2>English</h2><h3>Pronunciation</h3><ul><li><span class="IPA">/noːˈɔːdi.oʊ/</span></li></ul></div>';
		const entry = parseWiktionaryHtml(html, 'audio', 'en', 'audio', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.phonetics).toEqual([{ text: '/noːˈɔːdi.oʊ/' }]);
	});

	it.each([
		['vi', 'sample-vi.html', 'Danh từ', '/saːw˧˥/'],
		['ja', 'sample-ja.html', '名詞', '/koɴˈnitiwa/'],
		['ko', 'sample-ko.html', '명사', '[annjʌŋ]'],
		['zh', 'sample-zh.html', '名词', '/xɤ˧˥˩/'],
		['fr', 'sample-fr.html', 'Nom commun', '/sa.lu/'],
		['de', 'sample-de.html', 'Substantiv', '[ɡʁuːs]'],
		['es', 'sample-es.html', 'Sustantivo', '/oˈla/'],
		['it', 'sample-it.html', 'Sostantivo', '/ˈsalve/'],
		['ru', 'sample-ru.html', 'Существительное', '[ˈprʲivʲɪt]'],
	])('parses rendered HTML for %s', (language, file, partOfSpeech, ipa) => {
		const entry = parseWiktionaryHtml('' + fixture(file), 'hello', language, 'hello', 1700000000000, (value) => new JSDOM(value).window.document);

		expect(entry.meanings[0]?.partOfSpeech).toBe(partOfSpeech);
		expect(entry.meanings[0]?.definitions[0]?.text).toBeTruthy();
		expect(entry.phonetics).toEqual([{ text: ipa }]);
		expect(entry.translations.some((translation) => translation.languageCode === 'en' && translation.word === 'hello')).toBe(true);
	});
});
