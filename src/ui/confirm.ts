import { App, Modal } from 'obsidian';

export function confirmAction(app: App, title: string, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmationModal(app, title, message, resolve).open();
	});
}

class ConfirmationModal extends Modal {
	private resolved = false;
	constructor(app: App, private title: string, private message: string, private resolveAction: (confirmed: boolean) => void) {
		super(app);
	}

	onOpen() {
		this.contentEl.createEl('h2', { text: this.title });
		this.contentEl.createEl('p', { text: this.message });
		const actions = this.contentEl.createDiv('mynary-confirm-actions');
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.finish(false));
		const confirm = actions.createEl('button', { text: 'Confirm', cls: 'mod-warning' });
		confirm.addEventListener('click', () => this.finish(true));
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) this.resolveAction(false);
	}

	private finish(confirmed: boolean) {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveAction(confirmed);
		this.close();
	}
}
