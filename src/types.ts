export interface Phonetic { text: string; type?: string; }
export interface Definition { text: string; examples: string[]; }
export interface Meaning { partOfSpeech?: string; etymology?: string; definitions: Definition[]; }
export interface Translation {
	word: string;
	language?: string;
	languageCode?: string;
	languageName?: string;
	sense?: string;
	labels?: string[];
}
export interface DictionarySource { id: string; name: string; url: string; }
export interface DictionaryEntry { word: string; language: string; phonetics: Phonetic[]; meanings: Meaning[]; translations: Translation[]; synonyms: string[]; antonyms: string[]; etymology?: string; source: DictionarySource; fetchedAt: number; }
export interface TemplateDefinition { id: string; name: string; content: string; }
