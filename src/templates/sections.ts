export const MANAGED_SECTION_START = '<!-- mynary:lookup:start -->';
export const MANAGED_SECTION_END = '<!-- mynary:lookup:end -->';

export function updateManagedSection(existing: string, generated: string): string {
	const managed = `${MANAGED_SECTION_START}\n${generated.trim()}\n${MANAGED_SECTION_END}`;
	const start = existing.indexOf(MANAGED_SECTION_START);
	const end = existing.indexOf(MANAGED_SECTION_END, start + MANAGED_SECTION_START.length);
	if (start >= 0 && end >= 0) {
		return `${existing.slice(0, start)}${managed}${existing.slice(end + MANAGED_SECTION_END.length)}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
	}
	const prefix = existing.trimEnd();
	return prefix ? `${prefix}\n\n${managed}\n` : `${managed}\n`;
}
