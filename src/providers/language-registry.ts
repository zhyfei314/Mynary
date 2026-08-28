export interface WiktionaryLanguage {
	code: string;
	displayName: string;
	nativeName: string;
	wiktionarySubdomain: string;
	languageHeadingAliases: string[];
	partOfSpeechAliases: string[];
	translationAliases: string[];
	pronunciationAliases: string[];
}

const common = (displayName: string, nativeName: string, languageHeadingAliases: string[], partOfSpeechAliases: string[], translationAliases: string[], pronunciationAliases: string[]): Omit<WiktionaryLanguage, 'code' | 'wiktionarySubdomain'> => ({
	displayName, nativeName,
	languageHeadingAliases: [...new Set([displayName, nativeName, ...languageHeadingAliases])],
	partOfSpeechAliases: [...new Set(partOfSpeechAliases)],
	translationAliases: [...new Set(['Translations', ...translationAliases])],
	pronunciationAliases: [...new Set(['Pronunciation', ...pronunciationAliases])],
});

function language(code: string, data: Omit<WiktionaryLanguage, 'code' | 'wiktionarySubdomain'>): WiktionaryLanguage {
	return { code, wiktionarySubdomain: `${code}.wiktionary.org`, ...data };
}

// Wiktionary uses localized section names and grammatical labels, so a code alone is not enough.
export const WIKTIONARY_LANGUAGES: WiktionaryLanguage[] = [
	language('ar', common('Arabic', 'العربية', [], ['اسم', 'فعل', 'صفة', 'ظرف'], ['ترجمات', 'الترجمات'], ['النطق', 'لفظ'])),
	language('bg', common('Bulgarian', 'Български', [], ['Съществително име', 'Глагол', 'Прилагателно', 'Наречие'], ['Преводи'], ['Произношение'])),
	language('cs', common('Czech', 'Čeština', [], ['Podstatné jméno', 'Sloveso', 'Přídavné jméno', 'Příslovce'], ['Překlady'], ['Výslovnost'])),
	language('da', common('Danish', 'Dansk', [], ['Substantiv', 'Verbum', 'Adjektiv', 'Adverbium'], ['Oversættelser'], ['Udtale'])),
	language('de', common('German', 'Deutsch', [], ['Substantiv', 'Verb', 'Adjektiv', 'Adverb'], ['Übersetzungen'], ['Aussprache'])),
	language('el', common('Greek', 'Ελληνικά', [], ['ουσιαστικό', 'ρήμα', 'επίθετο', 'επίρρημα'], ['Μεταφράσεις'], ['Προφορά'])),
	language('en', common('English', 'English', [], ['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition'], ['Translations'], ['Pronunciation'])),
	language('es', common('Spanish', 'Español', [], ['Sustantivo', 'Verbo', 'Adjetivo', 'Adverbio'], ['Traducciones'], ['Pronunciación'])),
	language('et', common('Estonian', 'Eesti', [], ['Nimisõna', 'Tegusõna', 'Omadussõna', 'Määrsõna'], ['Tõlked'], ['Hääldus'])),
	language('fi', common('Finnish', 'Suomi', [], ['Substantiivi', 'Verbi', 'Adjektiivi', 'Adverbi'], ['Käännökset'], ['Ääntäminen'])),
	language('fr', common('French', 'Français', [], ['Nom commun', 'Verbe', 'Adjectif', 'Adverbe'], ['Traductions'], ['Prononciation'])),
	language('he', common('Hebrew', 'עברית', [], ['שם עצם', 'פועל', 'שם תואר', 'תואר הפועל'], ['תרגומים'], ['הגייה'])),
	language('hi', common('Hindi', 'हिन्दी', [], ['संज्ञा', 'क्रिया', 'विशेषण', 'क्रियाविशेषण'], ['अनुवाद'], ['उच्चारण'])),
	language('hr', common('Croatian', 'Hrvatski', [], ['Imenica', 'Glagol', 'Pridjev', 'Prilog'], ['Prijevodi'], ['Izgovor'])),
	language('hu', common('Hungarian', 'Magyar', [], ['Főnév', 'Ige', 'Melléknév', 'Határozószó'], ['Fordítások'], ['Kiejtés'])),
	language('id', common('Indonesian', 'Bahasa Indonesia', [], ['Nomina', 'Verba', 'Adjektiva', 'Adverbia'], ['Terjemahan'], ['Pelafalan'])),
	language('it', common('Italian', 'Italiano', [], ['Sostantivo', 'Verbo', 'Aggettivo', 'Avverbio'], ['Traduzioni'], ['Pronuncia'])),
	language('ja', common('Japanese', '日本語', [], ['名詞', '動詞', '形容詞', '副詞'], ['翻訳'], ['発音'])),
	language('ko', common('Korean', '한국어', [], ['명사', '동사', '형용사', '부사'], ['번역'], ['발음'])),
	language('lt', common('Lithuanian', 'Lietuvių', [], ['Daiktavardis', 'Veiksmažodis', 'Būdvardis', 'Prieveiksmis'], ['Vertimai'], ['Tarimas'])),
	language('lv', common('Latvian', 'Latviešu', [], ['Lietvārds', 'Darbības vārds', 'Īpašības vārds', 'Apstākļa vārds'], ['Tulkojumi'], ['Izruna'])),
	language('nl', common('Dutch', 'Nederlands', [], ['Zelfstandig naamwoord', 'Werkwoord', 'Bijvoeglijk naamwoord', 'Bijwoord'], ['Vertalingen'], ['Uitspraak'])),
	language('no', common('Norwegian', 'Norsk', [], ['Substantiv', 'Verb', 'Adjektiv', 'Adverb'], ['Oversettelser'], ['Uttale'])),
	language('pl', common('Polish', 'Polski', [], ['Rzeczownik', 'Czasownik', 'Przymiotnik', 'Przysłówek'], ['Tłumaczenia'], ['Wymowa'])),
	language('pt', common('Portuguese', 'Português', [], ['Substantivo', 'Verbo', 'Adjetivo', 'Advérbio'], ['Traduções'], ['Pronúncia'])),
	language('ro', common('Romanian', 'Română', [], ['Substantiv', 'Verb', 'Adjectiv', 'Adverb'], ['Traduceri'], ['Pronunție'])),
	language('ru', common('Russian', 'Русский', [], ['существительное', 'глагол', 'прилагательное', 'наречие'], ['Переводы'], ['Произношение'])),
	language('sk', common('Slovak', 'Slovenčina', [], ['Podstatné meno', 'Sloveso', 'Prídavné meno', 'Príslovka'], ['Preklady'], ['Výslovnosť'])),
	language('sl', common('Slovenian', 'Slovenščina', [], ['Samostalnik', 'Glagol', 'Pridevnik', 'Prislov'], ['Prevodi'], ['Izgovorjava'])),
	language('sv', common('Swedish', 'Svenska', [], ['Substantiv', 'Verb', 'Adjektiv', 'Adverb'], ['Översättningar'], ['Uttal'])),
	language('th', common('Thai', 'ไทย', [], ['คำนาม', 'คำกริยา', 'คำคุณศัพท์', 'คำวิเศษณ์'], ['คำแปล'], ['การออกเสียง'])),
	language('tr', common('Turkish', 'Türkçe', [], ['İsim', 'Fiil', 'Sıfat', 'Zarf'], ['Çeviriler'], ['Söyleniş'])),
	language('uk', common('Ukrainian', 'Українська', [], ['іменник', 'дієслово', 'прикметник', 'прислівник'], ['Переклади'], ['Вимова'])),
	language('vi', common('Vietnamese', 'Tiếng Việt', [], ['Danh từ', 'Động từ', 'Tính từ', 'Trạng từ'], ['Bản dịch'], ['Cách phát âm'])),
	language('zh', common('Chinese', '汉语', ['中文'], ['名词', '动词', '形容词', '副词'], ['翻译'], ['发音'])),
];

export function getWiktionaryLanguage(code: string): WiktionaryLanguage | undefined {
	return WIKTIONARY_LANGUAGES.find((language) => language.code === code.toLocaleLowerCase());
}

export function getLanguageHeadingAliases(code: string): string[] {
	return getWiktionaryLanguage(code)?.languageHeadingAliases ?? [code];
}

export function getSectionAliases(code: string, section: 'partOfSpeech' | 'translations' | 'pronunciation'): string[] {
	const language = getWiktionaryLanguage(code);
	if (!language) return section === 'partOfSpeech' ? [] : [section === 'translations' ? 'Translations' : 'Pronunciation'];
	if (section === 'partOfSpeech') return language.partOfSpeechAliases;
	return section === 'translations' ? language.translationAliases : language.pronunciationAliases;
}
