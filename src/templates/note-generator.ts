import type { DictionarySettings } from '../settings';
import type { DictionaryEntry } from '../types';
import { renderTemplate } from './renderer';
import { updateManagedSection } from './sections';

export interface NoteVault<TFile = unknown> {
	getAbstractFileByPath(path: string): unknown;
	createFolder(path: string): Promise<unknown>;
	create(path: string, content: string): Promise<TFile>;
	read(file: TFile): Promise<string>;
	modify(file: TFile, content: string): Promise<void>;
}

export async function createVocabularyNoteInVault<TFile>(vault: NoteVault<TFile>, entry: DictionaryEntry, settings: DictionarySettings, templateId = settings.defaultTemplateId, confirmReplace: () => Promise<boolean> = async () => true): Promise<TFile> {
	const template = settings.templates.find((item) => item.id === templateId) ?? settings.templates[0];
	if (!template) throw new Error('No vocabulary template is configured.');
	const generated = renderTemplate(entry, template.content);
	const content = settings.existingNoteBehavior === 'update-section' ? updateManagedSection('', generated) : generated;
	const filename = renderTemplate(entry, settings.filenameTemplate).replace(/[\\/:*?"<>|]/g, '-').trim() || entry.word;
	const folder = normalizeVaultPath(settings.noteFolder.trim());
	if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
	const path = normalizeVaultPath(`${folder ? `${folder}/` : ''}${filename}.md`);
	const existing = vault.getAbstractFileByPath(path);
	const existingFile = isVaultFile<TFile>(existing) ? existing : undefined;
	if (existingFile) {
		if (settings.existingNoteBehavior === 'ask' && !(await confirmReplace())) throw new Error(`Note creation cancelled for “${existingFile.path}”.`);
		if (settings.existingNoteBehavior === 'update-section') {
			const current = await vault.read(existingFile);
			await vault.modify(existingFile, updateManagedSection(current, generated));
		} else {
			await vault.modify(existingFile, generated);
		}
		return existingFile;
	}
	return vault.create(path, content);
}

export function normalizeVaultPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function isVaultFile<TFile>(value: unknown): value is TFile & { path: string; stat: unknown } {
	return Boolean(value && typeof value === 'object' && 'path' in value && 'stat' in value);
}
