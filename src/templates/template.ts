import type { App, TFile } from 'obsidian';
import type { DictionarySettings } from '../settings';
import type { DictionaryEntry } from '../types';
import { confirmAction } from '../ui/confirm';
import { createVocabularyNoteInVault } from './note-generator';

export { renderTemplate } from './renderer';

export async function createVocabularyNote(app: App, entry: DictionaryEntry, settings: DictionarySettings, templateId = settings.defaultTemplateId): Promise<TFile> {
	return createVocabularyNoteInVault(app.vault, entry, settings, templateId, () => confirmAction(app, 'Replace existing note?', `Replace “${entry.word}” with the selected dictionary template?`));
}
