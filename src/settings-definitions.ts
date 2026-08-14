export interface DeclarativeSettingDefinition {
	name: string;
	desc?: string;
	aliases?: string[];
	action?: () => void;
	control?: {
		type: 'text' | 'dropdown' | 'slider';
		key: string;
		options?: Record<string, string>;
		defaultValue?: string | number;
		placeholder?: string;
		min?: number;
		max?: number;
		step?: number;
		validate?: (value: string | number) => string | undefined;
	};
}
