export type FlashcardSide = 'front' | 'back';

const MARKER_PATTERN = /<!--\s*mynary\s*[:_-]\s*(front|question|prompt|back|answer|reverse)\s*[:_-]\s*(start|end|begin|close|open|stop)\s*-->/giu;

export function extractFlashcardSide(markdown: string, side: FlashcardSide): string | undefined {
	const markers = [...markdown.matchAll(MARKER_PATTERN)];
	const aliases = side === 'front' ? ['front', 'question', 'prompt'] : ['back', 'answer', 'reverse'];
	const start = markers.find((marker) => aliases.includes((marker[1] ?? '').toLocaleLowerCase()) && isOpening(marker[2] ?? ''));
	if (!start || start.index === undefined) return undefined;
	const end = markers.find((marker) => marker.index !== undefined && marker.index > start.index && aliases.includes((marker[1] ?? '').toLocaleLowerCase()) && isClosing(marker[2] ?? ''));
	if (!end || end.index === undefined) return undefined;
	const startEnd = start.index + start[0].length;
	return markdown.slice(startEnd, end.index).trim() || undefined;
}

export function hasFlashcardSide(markdown: string, side: FlashcardSide): boolean {
	const aliases = side === 'front' ? ['front', 'question', 'prompt'] : ['back', 'answer', 'reverse'];
	return [...markdown.matchAll(MARKER_PATTERN)].some((marker) => aliases.includes((marker[1] ?? '').toLocaleLowerCase()) && isOpening(marker[2] ?? ''));
}

function isOpening(value: string) { return value.toLocaleLowerCase() === 'start' || value.toLocaleLowerCase() === 'begin' || value.toLocaleLowerCase() === 'open'; }
function isClosing(value: string) { return value.toLocaleLowerCase() === 'end' || value.toLocaleLowerCase() === 'close' || value.toLocaleLowerCase() === 'stop'; }
