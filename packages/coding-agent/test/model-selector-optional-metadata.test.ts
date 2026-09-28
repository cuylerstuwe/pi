import type { ModelsRefreshResult } from "@earendil-works/pi-ai";
import { setKeybindings, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { terminal: { rows: 24 }, requestRender: () => {} } as unknown as TUI;
}

describe("model selector without complete picker metadata", () => {
	let harness: Harness;
	let selector: ModelSelectorComponent | undefined;

	beforeAll(() => initTheme("dark"));
	beforeEach(() => setKeybindings(new KeybindingsManager()));
	afterEach(() => {
		selector?.dispose();
		selector = undefined;
		harness?.cleanup();
		vi.restoreAllMocks();
	});

	it.each([false, true])("keeps ordinary models usable without models.json (scoped: %s)", async (scoped) => {
		harness = await createHarness({
			models: [
				{ id: "first-model", name: "First model" },
				{ id: "current-model", name: "Current model" },
				{ id: "default-model", name: "Default model" },
			],
		});
		const runtime = harness.session.modelRuntime;
		const models = harness.models.map((model) => runtime.getModel(model.provider, model.id)!);
		const onSelect = vi.fn();
		selector = new ModelSelectorComponent(
			createFakeTui(),
			models[1],
			runtime,
			scoped ? models.map((model) => ({ model })) : [],
			onSelect,
			() => {},
			undefined,
			undefined,
			models[2],
		);
		await vi.waitFor(() =>
			expect(stripAnsi(selector!.render(120).join("\n"))).toContain("Model catalogs refreshed."),
		);
		const rows = selector
			.render(120)
			.map(stripAnsi)
			.filter((line) => line.includes(`[${models[0].provider}]`));
		expect(rows.map((line) => line.slice(4).trim().split(/ +/)[0])).toEqual(
			scoped ? ["first-model", "current-model", "default-model"] : ["current-model", "default-model", "first-model"],
		);
		expect(rows.join("\n")).not.toMatch(/INT:|DEX:|undefined|NaN/);
		expect(rows.find((line) => line.includes("current-model"))).toMatch(/^→ ✓/);
		expect(rows.find((line) => line.includes("default-model"))).toContain("· default");
		selector.handleInput("no-matching-model-xyz");
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("No matching models");
		selector.handleInput("\r");
		expect(onSelect).not.toHaveBeenCalled();
		selector.handleInput("\x15");
		selector.handleInput("first-model");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(models[0]);
	});

	it.each([false, true])("mixes plain, partial, and empty metadata (scoped: %s)", async (scoped) => {
		harness = await createHarness({
			modelsJson: {
				providers: {
					"test-router": {
						baseUrl: "https://example.invalid/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: [
							{ id: "plain" },
							{ id: "named", pickerName: "A family" },
							{ id: "partial", pickerDex: { code: 55 }, pickerParams: { total: 12 } },
							{ id: "empty", pickerDex: {}, pickerParams: {}, pickerColors: [] },
						],
						modelOverrides: { missing: { pickerAlias: "unused" } },
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const models = ["plain", "named", "partial", "empty"].map((id) => runtime.getModel("test-router", id)!);
		expect(runtime.getError()).toBeUndefined();
		expect(runtime.getModel("test-router", "missing")).toBeUndefined();
		const onSelect = vi.fn();
		selector = new ModelSelectorComponent(
			createFakeTui(),
			models[0],
			runtime,
			scoped ? models.map((model) => ({ model })) : [],
			onSelect,
			() => {},
		);
		await vi.waitFor(() =>
			expect(stripAnsi(selector!.render(120).join("\n"))).toContain("Model catalogs refreshed."),
		);
		const rows = selector
			.render(120)
			.map(stripAnsi)
			.filter((line) => line.includes("[test-router]"));
		expect(rows).toHaveLength(4);
		expect(rows.find((line) => /\bplain\b/.test(line))).not.toMatch(/DEX:|INT:|\{/);
		expect(rows.find((line) => /\bpartial\b/.test(line))).toContain("DEX: ?/55/? t/s { 12B / ? }");
		expect(rows.find((line) => /\bempty\b/.test(line))).toMatch(/DEX: \?\/\?\/\? t\/s +\{ \? \/ \? \}/);
		expect(rows.join("\n")).not.toMatch(/undefined|NaN/);
		for (const width of [20, 40, 80]) {
			expect(selector.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		selector.handleInput("55");
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("DEX: ?/55/? t/s");
		selector.handleInput("\x15");
		selector.handleInput("plain");
		const filtered = stripAnsi(selector.render(120).join("\n"));
		expect(filtered).toContain("→ ✓ plain [test-router]");
		expect(filtered).not.toMatch(/DEX:|INT:/);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(models[0]);
	});

	it("accepts a new unconfigured provider and model during catalog refresh", async () => {
		harness = await createHarness();
		const runtime = harness.session.modelRuntime;
		const original = harness.getModel();
		const pending = Promise.withResolvers<ModelsRefreshResult>();
		vi.spyOn(runtime, "refresh").mockReturnValue(pending.promise);
		const onSelect = vi.fn();
		selector = new ModelSelectorComponent(
			createFakeTui(),
			original,
			runtime,
			[{ model: original }],
			onSelect,
			() => {},
		);
		expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("new-provider");
		runtime.registerProvider("new-provider", {
			apiKey: "test-key",
			baseUrl: "https://example.invalid/v1",
			api: "openai-completions",
			models: [{ ...original, api: "openai-completions", id: "discovered-model", name: "Discovered model" }],
		});
		pending.resolve({ aborted: false, errors: new Map() });
		await vi.waitFor(() =>
			expect(stripAnsi(selector!.render(120).join("\n"))).toContain("Model catalogs refreshed."),
		);
		// Keep the curated scope intact; newly discovered models remain available in the full catalog.
		expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("new-provider");
		selector.handleInput("\t");
		selector.handleInput("new-provider/discovered-model");
		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("→   discovered-model [new-provider]");
		expect(rendered).not.toMatch(/INT:|DEX:|undefined|NaN/);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(runtime.getModel("new-provider", "discovered-model"));
	});

	it("keeps unknown models selectable beside ranked models from another provider", async () => {
		harness = await createHarness({
			modelsJson: {
				providers: {
					"ranked-provider": {
						baseUrl: "https://example.invalid/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: [
							{
								id: "ranked",
								pickerAlias: "custom",
								pickerGroup: "local",
								pickerOrder: 0,
								pickerProviderOrder: -1,
							},
						],
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const plain = harness.getModel();
		const ranked = runtime.getModel("ranked-provider", "ranked")!;
		const onSelect = vi.fn();
		selector = new ModelSelectorComponent(createFakeTui(), ranked, runtime, [], onSelect, () => {});
		await vi.waitFor(() =>
			expect(stripAnsi(selector!.render(120).join("\n"))).toContain("Model catalogs refreshed."),
		);
		const rows = selector.render(120).map(stripAnsi);
		expect(rows.findIndex((line) => line.includes(`[${plain.provider}]`))).toBeLessThan(
			rows.findIndex((line) => line.includes("[ranked-provider]")),
		);
		selector.handleInput(`${plain.provider}/${plain.id}`);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(runtime.getModel(plain.provider, plain.id));
	});

	it("renders an empty available catalog and ignores selection keys", async () => {
		harness = await createHarness({ withConfiguredAuth: false });
		const runtime = harness.session.modelRuntime;
		vi.spyOn(runtime, "getAvailableSnapshot").mockReturnValue([]);
		const onSelect = vi.fn();
		const onSave = vi.fn();
		selector = new ModelSelectorComponent(
			createFakeTui(),
			undefined,
			runtime,
			[],
			onSelect,
			() => {},
			undefined,
			onSave,
		);
		await vi.waitFor(() =>
			expect(stripAnsi(selector!.render(120).join("\n"))).toContain("Model catalogs refreshed."),
		);
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("No matching models");
		for (const key of ["\x1b[A", "\x1b[B", "\r", "\x13", "\t"]) selector.handleInput(key);
		expect(onSelect).not.toHaveBeenCalled();
		expect(onSave).not.toHaveBeenCalled();
	});
});
