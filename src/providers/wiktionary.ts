import { DictionaryEntry } from '../types';
import { normalizeEntry, parseWiktionaryHtml } from './wiktionary-html-parser';
import type { TtsProvider } from './supertonic';

export interface WiktionaryHttpResponse { status: number; json: unknown; }
export type WiktionaryRequester = (url: string) => Promise<WiktionaryHttpResponse>;
const REQUEST_TIMEOUT_MS = 15_000;

export class WiktionaryProvider {
	constructor(
		private readonly request: WiktionaryRequester,
		private readonly tts?: TtsProvider,
		private readonly autoTts = false,
	) {}

	get ttsAvailable() { return Boolean(this.tts); }
	ttsAvailableFor(language: string) { const tts = this.tts; if (!tts) return false; return tts.supportsLanguage?.(language) ?? true; }

	async synthesizeTts(text: string, language: string) {
		if (!this.tts) throw new Error('Supertonic is disabled.');
		return this.tts.synthesize(text, language);
	}

	async lookup(word: string, language: string): Promise<DictionaryEntry> {
		const baseUrl = `https://${language}.wiktionary.org/w/api.php`;
		const requestedTitle = word.trim();
		const direct = await this.fetchPage(baseUrl, requestedTitle);
		if (direct.html && direct.title) {
			const entry = await this.parsePage(baseUrl, word, language, direct.title, direct.html);
			return entry;
		}
		const lowercaseTitle = requestedTitle.toLocaleLowerCase();
		if (lowercaseTitle !== requestedTitle) {
			const lowercase = await this.fetchPage(baseUrl, lowercaseTitle);
			if (lowercase.html && lowercase.title) {
				const entry = await this.parsePage(baseUrl, word, language, lowercase.title, lowercase.html);
				return entry;
			}
		}

		// Wiktionary can keep a lowercase entry such as `hello` while a user
		// naturally enters `Hello`. Search resolves redirects and title casing.
		const searchUrl = `${baseUrl}?action=query&list=search&srsearch=${encodeURIComponent(requestedTitle)}&srnamespace=0&srlimit=1&format=json&origin=*`;
		const searchResponse = await this.requestWithTimeout(searchUrl);
		this.assertSuccess(searchResponse.status);
		const searchData = searchResponse.json as { query?: { search?: Array<{ title?: string }> } };
		const resolvedTitle = searchData.query?.search?.[0]?.title;
		if (resolvedTitle && resolvedTitle.toLowerCase() !== requestedTitle.toLowerCase()) {
			const resolved = await this.fetchPage(baseUrl, resolvedTitle);
			if (resolved.html && resolved.title) {
				const entry = await this.parsePage(baseUrl, word, language, resolved.title, resolved.html);
				return entry;
			}
		}
		throw new Error(`No entry found for “${word}”.`);
	}

	private async fetchPage(baseUrl: string, title: string): Promise<{ title?: string; html?: string }> {
		const url = `${baseUrl}?action=parse&page=${encodeURIComponent(title)}&prop=text%7Cwikitext&format=json&origin=*`;
		const response = await this.requestWithTimeout(url);
		this.assertSuccess(response.status);
		const data = response.json as { parse?: { title?: string; text?: { '*': string }; wikitext?: { '*': string } }; error?: { code?: string } };
		return { title: data.parse?.title, html: data.parse?.text?.['*'] };
	}

	private async requestWithTimeout(url: string): Promise<WiktionaryHttpResponse> {
		let timeoutId: number | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timeoutId = window.setTimeout(() => reject(new Error(`Wiktionary request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)), REQUEST_TIMEOUT_MS);
		});
		try {
			return await Promise.race([this.request(url), timeout]);
		} finally {
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
		}
	}

	private async parsePage(baseUrl: string, word: string, language: string, title: string, html: string) {
		// Use rendered HTML as the single display source. Raw wikitext contains
		// citation templates and language metadata that are easy to leak into UI.
		let entry = parseWiktionaryHtml(html, word, language, title);
		if (this.autoTts && this.tts && entry.phonetics.length && !entry.phonetics.some((pronunciation) => pronunciation.audio?.length)) {
			try {
				entry = this.withAudio(entry, [await this.tts.synthesize(word, language)]);
			} catch {
				// TTS is optional; keep the IPA when the local server is unavailable.
			}
		}
		const hasTranslationSubpage = /\/translations(?:[#?"'\s]|$)/i.test(html);
		if (entry.translations.length > 0 && !hasTranslationSubpage) return entry;

		// Wiktionary moves large translation tables to a dedicated subpage,
		// e.g. /wiki/love/translations#Noun.
		try {
			const translationPage = await this.fetchPage(baseUrl, `${title}/translations`);
			if (!translationPage.html) return entry;
			const translationEntry = parseWiktionaryHtml(translationPage.html, word, language, title);
			return translationEntry.translations.length ? normalizeEntry({ ...entry, translations: [...entry.translations, ...translationEntry.translations] }) : entry;
		} catch {
			// A missing or rate-limited translation subpage must not discard the
			// definitions already parsed from the main entry.
			return entry;
		}
	}

	private withAudio(entry: DictionaryEntry, audio: DictionaryEntry['phonetics'][number]['audio']) {
		if (!audio?.length) return entry;
		return normalizeEntry({ ...entry, phonetics: entry.phonetics.map((pronunciation, index) => index === 0 ? { ...pronunciation, audio } : pronunciation) });
	}

	private assertSuccess(status: number) {
		if (status < 200 || status >= 300) throw new Error(`Wiktionary request failed (${status}).`);
	}
}
