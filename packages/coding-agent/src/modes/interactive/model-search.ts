import type { PickerThroughput } from "@earendil-works/pi-ai";

export interface ModelSearchItem {
	id: string;
	provider: string;
	name?: string;
	pickerName?: string;
	pickerAlias?: string;
	pickerHardware?: string;
	pickerIntelligence?: string;
	pickerDex?: { prefill?: PickerThroughput; code?: PickerThroughput; prose?: PickerThroughput };
	pickerParams?: { total?: number | string; active?: number | string };
}

export function formatPickerDex(dex: NonNullable<ModelSearchItem["pickerDex"]>): string {
	const rates = [dex.prefill, dex.code, dex.prose].map((value, index) => {
		if (value === null || value === undefined) return "?";
		const format = (rate: number): string =>
			index === 0 && rate > 1000 ? `${(rate / 1000).toFixed(1)}k` : String(Math.round(rate));
		return typeof value === "number" ? format(value) : `${format(value.min)}-${format(value.max)}`;
	});
	return `DEX: ${rates.join("/")} t/s`;
}

export function formatPickerParams(params: NonNullable<ModelSearchItem["pickerParams"]>): string {
	const total = typeof params.total === "number" ? `${params.total}B` : (params.total ?? "?");
	const active = typeof params.active === "number" ? `${params.active}B` : (params.active ?? "?");
	return `{ ${total} / ${active} }`;
}

export function getModelSearchText(item: ModelSearchItem): string {
	const { id, provider } = item;
	const name = item.name ? ` ${item.name}` : "";
	return `${id} ${provider} ${provider}/${id} ${provider} ${id}${name}`;
}

/**
 * The /model selector search should rank exact provider-prefixed queries before proxy-provider IDs
 * like openrouter/openai/gpt-5, so keep the bare model ID out of the leading position.
 */
export function getModelSelectorSearchText(item: ModelSearchItem): string {
	const { id, provider } = item;
	const name = item.name ? ` ${item.name}` : "";
	const pickerName = item.pickerName ? ` ${item.pickerName}` : "";
	const hardware = item.pickerHardware ? ` ${item.pickerHardware}` : "";
	const intelligence = item.pickerIntelligence ? ` INT: ${item.pickerIntelligence}` : "";
	const dex = item.pickerDex ? ` ${formatPickerDex(item.pickerDex)}` : "";
	const params = item.pickerParams ? ` ${formatPickerParams(item.pickerParams)}` : "";
	return `${provider} ${provider}/${id} ${provider} ${id} ${item.pickerAlias ?? ""}${name}${intelligence}${dex}${pickerName}${params}${hardware}`;
}
