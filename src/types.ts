export interface AudioSource {
	url: string;
	mimeType?: string;
	title?: string;
	provider?: 'wiktionary' | 'wikimedia-commons' | 'tts' | 'other';
	sourceUrl?: string;
	speaker?: string;
	transcription?: string;
	languageCode?: string;
	recordedAt?: string;
	confidence?: number;
}
export interface Pronunciation { text: string; type?: string; audio?: AudioSource[]; }
export interface Definition { text: string; examples: string[]; }
export interface Meaning { partOfSpeech?: string; labels?: string[]; etymology?: string; definitions: Definition[]; }
export interface Translation {
	word: string;
	language?: string;
	languageCode?: string;
	languageName?: string;
	sense?: string;
	labels?: string[];
}
export interface DictionarySource { id: string; name: string; url: string; }
export interface DictionaryEntry { word: string; baseWord?: string; inflection?: string; language: string; phonetics: Pronunciation[]; meanings: Meaning[]; translations: Translation[]; synonyms: string[]; antonyms: string[]; etymology?: string; source: DictionarySource; fetchedAt: number; }
export interface TemplateDefinition { id: string; name: string; content: string; }
