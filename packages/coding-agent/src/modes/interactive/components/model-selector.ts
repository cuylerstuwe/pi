import { type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	parseColor,
	Spacer,
	Text,
	TruncatedText,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ModelRuntime } from "../../../core/model-runtime.ts";
import { refreshModelCatalogs } from "../model-catalog-refresh.ts";
import { formatPickerDex, formatPickerParams, getModelSelectorSearchText } from "../model-search.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

interface DefaultModelReference {
	provider: string;
	id: string;
}

type ModelScope = "all" | "scoped";

function comparePickerGroups(a: ModelItem, b: ModelItem): number {
	return Number(a.model.pickerGroup === "local") - Number(b.model.pickerGroup === "local");
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private modelRuntime: ModelRuntime;
	private onSelectCallback: (model: Model<any>) => void;
	private onSelectAsDefaultCallback?: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private refreshStatusMessage = "Refreshing model catalogs…";
	private refreshStatusSuccess = false;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private defaultModel?: DefaultModelReference;
	private scope: ModelScope = "all";
	private lastTerminalRows = 0;
	private readonly refreshAbortController = new AbortController();
	private refreshTimeout?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		modelRuntime: ModelRuntime,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		onSelectAsDefault?: (model: Model<any>) => void,
		defaultModel?: DefaultModelReference,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.modelRuntime = modelRuntime;
		this.scopedModels = scopedModels;
		this.defaultModel = defaultModel;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onSelectAsDefaultCallback = onSelectAsDefault;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.addChild({
				render: (width) => new TruncatedText(this.getScopeText()).render(width),
				invalidate: () => {},
			});
		} else {
			const hintText = "Only showing models from configured providers. Use /login to add providers.";
			this.addChild(new TruncatedText(theme.fg("warning", hintText)));
		}

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Hint
		if (this.onSelectAsDefaultCallback) {
			this.addChild(
				new TruncatedText(
					theme.fg(
						"dim",
						`  ${keyDisplayText("tui.select.confirm")} select · ${keyDisplayText("app.models.save")} default · ${keyDisplayText("tui.select.cancel")} cancel`,
					),
				),
			);
		}

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Render the current snapshot immediately, then refresh in the background.
		this.loadModelsFromSnapshot();
		if (initialSearchInput) this.filterModels(initialSearchInput);
		else this.updateList();
		this.tui.requestRender();
		void this.refreshModels();
	}

	private loadModelsFromSnapshot(): void {
		const models = this.modelRuntime.getAvailableSnapshot().map((model: Model<any>) => ({
			provider: model.provider,
			id: model.id,
			model,
		}));
		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.applyPickerOrder(
			this.scopedModels.map((scoped) => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			})),
		);
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		this.filteredModels = this.activeModels;
		const currentIndex = this.filteredModels.findIndex((item) => modelsAreEqual(this.currentModel, item.model));
		this.selectedIndex =
			currentIndex >= 0 ? currentIndex : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
	}

	private async refreshModels(): Promise<void> {
		const timeoutMs = 15_000;
		let timedOut = false;
		this.refreshTimeout = setTimeout(() => {
			timedOut = true;
			this.refreshAbortController.abort();
		}, timeoutMs);
		try {
			const result = await refreshModelCatalogs(this.modelRuntime, this.refreshAbortController.signal);
			if (this.closed) return;
			this.refreshStatusMessage = "";
			if (result.aborted && timedOut) {
				this.errorMessage = "Model refresh timed out; showing cached models.";
			} else if (result.errors.size === 1) {
				this.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
			} else if (result.errors.size > 1) {
				this.errorMessage = `Could not refresh ${result.errors.size} model catalogs (${[...result.errors.keys()].join(", ")}); showing cached models.`;
			} else {
				this.errorMessage = this.modelRuntime.getError();
				if (!this.errorMessage) {
					this.refreshStatusMessage = "Model catalogs refreshed.";
					this.refreshStatusSuccess = true;
				}
			}
			this.loadModelsFromSnapshot();
			this.filterModels(this.searchInput.getValue());
			this.tui.requestRender();
		} catch (error) {
			if (this.closed) return;
			this.refreshStatusMessage = "";
			this.errorMessage = timedOut
				? "Model refresh timed out; showing cached models."
				: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`;
			this.updateList();
			this.tui.requestRender();
		} finally {
			if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		}
	}

	dispose(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		this.refreshAbortController.abort();
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, default model second, then by provider.
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			const aIsDefault = this.isDefaultModel(a.model);
			const bIsDefault = this.isDefaultModel(b.model);
			if (aIsDefault && !bIsDefault) return -1;
			if (!aIsDefault && bIsDefault) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return this.applyPickerOrder(sorted);
	}

	private applyPickerOrder(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		const providers = new Set(
			models.filter((item) => item.model.pickerOrder !== undefined).map((item) => item.provider),
		);
		for (const provider of providers) {
			const ordered = models
				.filter((item) => item.provider === provider)
				.sort((a, b) => {
					const aOrder = a.model.pickerOrder ?? Number.POSITIVE_INFINITY;
					const bOrder = b.model.pickerOrder ?? Number.POSITIVE_INFINITY;
					return aOrder === bOrder ? 0 : aOrder - bOrder;
				});
			// Reorder only this provider's slots, preserving other providers and unconfigured lists.
			let index = 0;
			for (let i = 0; i < sorted.length; i++) {
				if (sorted[i].provider === provider) sorted[i] = ordered[index++];
			}
		}
		const providerRanks = new Map<string, number>();
		for (const item of models) {
			if (item.model.pickerProviderOrder !== undefined) {
				providerRanks.set(
					item.provider,
					Math.min(providerRanks.get(item.provider) ?? Infinity, item.model.pickerProviderOrder),
				);
			}
		}
		return sorted.sort((a, b) => {
			const groupOrder = comparePickerGroups(a, b);
			if (groupOrder !== 0) return groupOrder;
			const aRank = providerRanks.get(a.provider) ?? Infinity;
			const bRank = providerRanks.get(b.provider) ?? Infinity;
			return aRank === bRank ? 0 : aRank - bRank;
		});
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}${theme.fg("muted", ` · ${keyDisplayText("tui.input.tab")} switch · /login add provider`)}`;
	}

	private isDefaultModel(model: Model<any>): boolean {
		return this.defaultModel?.provider === model.provider && this.defaultModel.id === model.id;
	}

	private isDefaultSearch(query: string): boolean {
		const normalized = query.trim().toLowerCase();
		return normalized.length > 0 && "default".startsWith(normalized);
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		const currentIndex = this.activeModels.findIndex((item) => modelsAreEqual(this.currentModel, item.model));
		this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
		this.filterModels(this.searchInput.getValue());
	}

	private filterModels(query: string): void {
		if (query) {
			const filtered = fuzzyFilter(this.activeModels, query, (item) => {
				const defaultText = this.isDefaultModel(item.model) ? " default" : "";
				return `${getModelSelectorSearchText(item.model)}${defaultText}`;
			});
			// An exact display alias should beat incidental matches in long descriptions.
			const normalizedQuery = query.trim().toLowerCase();
			const isExactAlias = (item: ModelItem): boolean => {
				const alias = item.model.pickerAlias?.toLowerCase();
				return (
					alias !== undefined &&
					(alias === normalizedQuery || `${item.provider.toLowerCase()}/${alias}` === normalizedQuery)
				);
			};
			filtered.sort((a, b) => Number(isExactAlias(b)) - Number(isExactAlias(a)));
			if (this.isDefaultSearch(query)) {
				const defaultItems = this.activeModels.filter((item) => this.isDefaultModel(item.model));
				const defaultKeys = new Set(defaultItems.map((item) => `${item.provider}\0${item.id}`));
				this.filteredModels = [
					...defaultItems,
					...filtered.filter((item) => !defaultKeys.has(`${item.provider}\0${item.id}`)),
				];
			} else {
				this.filteredModels = filtered;
			}
		} else {
			this.filteredModels = this.activeModels;
		}
		// Keep the best search match selected even when section ordering moves it.
		if (query) {
			const bestMatch = this.filteredModels[0];
			this.filteredModels.sort(comparePickerGroups);
			this.selectedIndex = bestMatch ? this.filteredModels.indexOf(bestMatch) : 0;
		} else {
			this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		}
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		// Reserve compact chrome, a section divider/paging status, and the Pi footer.
		const terminalRows = this.tui.terminal?.rows ?? 23;
		this.lastTerminalRows = terminalRows;
		const maxVisible = Math.max(1, terminalRows - 13);
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		// Measure only the current page, after filtering. ANSI colors do not occupy columns.
		const rows = this.filteredModels.slice(startIndex, endIndex).map((item, index) => {
			const isSelected = startIndex + index === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);
			const isDefault = this.isDefaultModel(item.model);

			const cursor = isSelected ? theme.fg("accent", "→ ") : "  ";
			const currentMarker = isCurrent ? theme.fg("accent", "✓ ") : "  ";
			const alias = item.model.pickerAlias ?? item.id;
			let modelText = isSelected ? theme.fg("accent", alias) : alias;
			if (item.model.pickerColors?.length) {
				const characters = Array.from(new Intl.Segmenter().segment(alias), (part) => part.segment);
				let offset = 0;
				modelText = "";
				for (const run of item.model.pickerColors) {
					const text = characters.slice(offset, offset + run.chars).join("");
					modelText += theme.style(text, { fg: parseColor(run.fg), bg: run.bg ? parseColor(run.bg) : undefined });
					offset += run.chars;
				}
				modelText += characters.slice(offset).join("");
			}
			const params = item.model.pickerParams;
			const dex = item.model.pickerDex;
			return {
				isLocal: item.model.pickerGroup === "local",
				prefix: `${cursor}${currentMarker}`,
				cells: [
					modelText,
					item.model.pickerIntelligence ? theme.fg("muted", `INT: ${item.model.pickerIntelligence}`) : "",
					dex ? theme.fg("muted", formatPickerDex(dex)) : "",
					params ? theme.fg("muted", formatPickerParams(params)) : "",
					item.model.pickerName ? theme.fg("muted", `(${item.model.pickerName})`) : "",
					item.model.pickerHardware ? theme.fg("muted", `[${item.model.pickerHardware}]`) : "",
					theme.fg("muted", `[${item.provider}]`),
					isDefault ? theme.fg("muted", "· default") : "",
				],
			};
		});
		const columnWidths = (rows[0]?.cells ?? []).map((_, column) =>
			Math.max(0, ...rows.map((row) => visibleWidth(row.cells[column]))),
		);
		const columns = columnWidths.flatMap((width, column) => (width > 0 ? [column] : []));
		for (const [index, row] of rows.entries()) {
			if (index > 0 && rows[index - 1].isLocal !== row.isLocal) {
				this.listContainer.addChild(new DynamicBorder());
			}
			const cells = columns.map((column, index) => {
				const cell = row.cells[column];
				const padding = index < columns.length - 1 ? columnWidths[column] - visibleWidth(cell) : 0;
				return cell + " ".repeat(padding);
			});

			this.listContainer.addChild(new TruncatedText(row.prefix + cells.join(" ")));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new TruncatedText(theme.fg("muted", `  Model Name: ${selected.model.name}`)));
		}
		if (this.refreshStatusMessage) {
			this.listContainer.addChild(
				new TruncatedText(
					theme.fg(this.refreshStatusSuccess ? "success" : "muted", `  ${this.refreshStatusMessage}`),
				),
			);
		}
	}

	override render(width: number): string[] {
		if ((this.tui.terminal?.rows ?? 23) !== this.lastTerminalRows) this.updateList();
		return super.render(width);
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) {
				const nextScope: ModelScope = this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
			}
			return;
		}
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			this.dispose();
			this.onCancelCallback();
		}
		// Select and save as default
		else if (kb.matches(keyData, "app.models.save") && this.onSelectAsDefaultCallback) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.dispose();
				this.onSelectAsDefaultCallback(selectedModel.model);
			}
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		this.dispose();
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
