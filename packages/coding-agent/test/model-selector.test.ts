import { foregroundAnsi, parseColor, setKeybindings, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(rows = 23): TUI {
	return { terminal: { rows }, requestRender: () => {} } as unknown as TUI;
}

describe("model selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("keeps the current model marked while browsing", async () => {
		harness = await createHarness({
			models: [
				{ id: "current-model", name: "Current Model", reasoning: true },
				{ id: "browsed-model", name: "Browsed Model", reasoning: true },
			],
		});
		const currentModel = harness.getModel("current-model")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		const getModelRow = (id: string): string | undefined =>
			stripAnsi(selector.render(120).join("\n"))
				.split("\n")
				.find((line) => line.includes(`${id} [`))
				?.trimEnd();

		expect(getModelRow("current-model")).toBe(`→ ✓ current-model [${currentModel.provider}]`);
		selector.handleInput("\x1b[B");
		expect(getModelRow("current-model")).toBe(`  ✓ current-model [${currentModel.provider}]`);
		expect(getModelRow("browsed-model")).toBe(`→   browsed-model [${currentModel.provider}]`);
		selector.dispose();
	});

	it("uses the configured save binding", async () => {
		setKeybindings(new KeybindingsManager({ "app.models.save": "ctrl+r" }));
		harness = await createHarness();
		const currentModel = harness.getModel()!;
		const saveDefault = vi.fn();
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
			undefined,
			saveDefault,
		);

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Ctrl+R default");
		selector.handleInput("\x13");
		expect(saveDefault).not.toHaveBeenCalled();
		selector.handleInput("\x12");
		expect(saveDefault).toHaveBeenCalledWith(currentModel);
	});

	it("shows and searches picker names while selecting the original routing model", async () => {
		harness = await createHarness({
			modelsJson: {
				providers: {
					"test-router": {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: [{ id: "alias", name: "Full deployment description", pickerName: "short family" }],
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const model = runtime.getModel("test-router", "alias")!;
		const select = vi.fn();
		const selector = new ModelSelectorComponent(createFakeTui(), model, runtime, [], select, () => {});
		await vi.waitFor(() => {
			expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed.");
		});
		selector.handleInput("short family");
		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("→ ✓ alias (short family) [test-router]");
		expect(rendered).toContain("Model Name: Full deployment description");
		selector.handleInput("\r");
		expect(select).toHaveBeenCalledWith(model);
		expect(model).toMatchObject({ id: "alias", provider: "test-router", baseUrl: "http://localhost:1234/v1" });
	});

	it.each([false, true])(
		"keeps configured provider order ahead of current/default priorities (scoped: %s)",
		async (scoped) => {
			harness = await createHarness({
				modelsJson: {
					providers: {
						"test-router": {
							baseUrl: "http://localhost:1234/v1",
							api: "openai-completions",
							apiKey: "test-key",
							models: [
								{ id: "small", pickerOrder: 3 },
								{ id: "medium", pickerOrder: 2 },
								{ id: "large", pickerOrder: 4 },
								{ id: "unranked" },
							],
							modelOverrides: { large: { pickerName: "largest family", pickerOrder: 1 } },
						},
					},
				},
			});
			const runtime = harness.session.modelRuntime;
			const currentModel = runtime.getModel("test-router", "small")!;
			const scope = scoped
				? ["small", "medium", "large", "unranked"].map((id) => ({ model: runtime.getModel("test-router", id)! }))
				: [];
			const selector = new ModelSelectorComponent(
				createFakeTui(),
				currentModel,
				runtime,
				scope,
				() => {},
				() => {},
				undefined,
				undefined,
				{ provider: "test-router", id: "medium" },
			);
			await vi.waitFor(() => {
				expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed.");
			});
			const rows = stripAnsi(selector.render(120).join("\n"))
				.split("\n")
				.filter((line) => line.includes("[test-router]"));
			expect(rows.map((line) => line.slice(0, 4) + line.slice(4).trim().replace(/ +/g, " "))).toEqual([
				"    large (largest family) [test-router]",
				"    medium [test-router] · default",
				"→ ✓ small [test-router]",
				"    unranked [test-router]",
			]);
			selector.dispose();
		},
	);

	it("aligns optional columns by terminal width and preserves colors, search, and routing", async () => {
		harness = await createHarness({
			modelsJson: {
				providers: {
					"test-router": {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: [
							{
								id: "sample",
								pickerOrder: 1,
								pickerName: "family-a",
								pickerIntelligence: "42",
								pickerDex: { prefill: 1100.4, code: 60.1, prose: 30.8 },
								pickerHardware: "accelerator A",
								pickerParams: { total: 320, active: 18 },
							},
							{ id: "alt", pickerOrder: 2, pickerName: "family-b", pickerParams: { total: 27, active: 27 } },
							{
								id: "東京🦆",
								pickerOrder: 3,
								pickerName: "unicode",
								pickerIntelligence: "9-14*",
								pickerParams: { total: 2, active: 2 },
							},
							{ id: "unknown", pickerOrder: 4 },
						],
						modelOverrides: {
							sample: { pickerColors: [{ chars: 6, fg: "#DDAA33", bg: "#112244" }] },
							alt: {
								pickerIntelligence: "20-34",
								pickerDex: { prefill: 2100, code: 160, prose: 130 },
								pickerHardware: "accelerator B",
								pickerParams: { total: 29, active: 29 },
								pickerColors: [
									{ chars: 1, fg: "#DD6677" },
									{ chars: 2, fg: "#6688DD" },
								],
							},
						},
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const models = ["sample", "alt", "東京🦆", "unknown"].map((id) => runtime.getModel("test-router", id)!);
		const select = vi.fn();
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			models[0],
			runtime,
			models.map((model) => ({ model })),
			select,
			() => {},
			undefined,
			undefined,
			{ provider: "test-router", id: "sample" },
		);
		await vi.waitFor(() => expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed."));
		const rows = selector.render(120).filter((line) => stripAnsi(line).includes("[test-router]"));
		const plain = rows.map(stripAnsi);
		for (const delimiter of ["INT:", "DEX:", "{", "(", "[test-router]"]) {
			const offsets = plain
				.filter((line) => line.includes(delimiter))
				.map((line) => visibleWidth(line.slice(0, line.indexOf(delimiter))));
			expect(new Set(offsets).size).toBe(1);
		}
		expect(plain[0]).toContain("INT: 42");
		expect(plain[1]).toContain("INT: 20-34");
		expect(plain[2]).toContain("INT: 9-14*");
		expect(plain[0].indexOf("INT:")).toBeGreaterThan(plain[0].indexOf("sample"));
		expect(plain[0].indexOf("INT:")).toBeLessThan(plain[0].indexOf("{"));
		expect(plain[3]).not.toContain("INT:");
		expect(plain[0]).toContain("DEX: 1.1k/60/31 t/s");
		expect(plain[1]).toContain("DEX: 2.1k/160/130 t/s");
		expect(plain[0].indexOf("DEX:")).toBeGreaterThan(plain[0].indexOf("INT:"));
		expect(plain[0].indexOf("DEX:")).toBeLessThan(plain[0].indexOf("{"));
		expect(plain[2]).not.toContain("DEX:");
		expect(plain[3]).not.toContain("DEX:");
		expect(plain[0]).toContain("{ 320B / 18B }");
		expect(plain[1]).toContain("{ 29B / 29B }");
		expect(plain[0]).toContain("[accelerator A]");
		expect(plain[1]).toContain("[accelerator B]");
		expect(plain[0].indexOf("[accelerator A]")).toBe(plain[1].indexOf("[accelerator B]"));
		expect(plain[0].indexOf("[accelerator A]")).toBeGreaterThan(plain[0].indexOf("(family-a)"));
		expect(plain[0].indexOf("[accelerator A]")).toBeLessThan(plain[0].indexOf("[test-router]"));
		expect(plain[3]).not.toContain("{");
		const gold = foregroundAnsi(parseColor("#DDAA33"), theme.getColorMode());
		const red = foregroundAnsi(parseColor("#DD6677"), theme.getColorMode());
		const blue = foregroundAnsi(parseColor("#6688DD"), theme.getColorMode());
		expect(rows[0]).toContain(gold);
		expect(rows[1]).toContain(`${red}a`);
		expect(rows[1]).toContain(`${blue}lt`);
		selector.handleInput("\x1b[B");
		const sample = selector.render(120).find((line) => stripAnsi(line).startsWith("  ✓ sample"))!;
		expect(sample).toContain(gold);
		// Background resets before alignment padding and other columns.
		expect(sample).toMatch(/sample\x1b\[49m\x1b\[39m +/);
		for (const width of [20, 40, 80]) {
			expect(selector.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		selector.handleInput("29B");
		const filtered = stripAnsi(selector.render(120).join("\n"));
		expect(filtered).toContain(
			"→   alt INT: 20-34 DEX: 2.1k/160/130 t/s { 29B / 29B } (family-b) [accelerator B] [test-router]",
		);
		expect(filtered).not.toContain("{ 320B / 18B }");
		selector.handleInput("\x15");
		selector.handleInput("accelerator B");
		expect(stripAnsi(selector.render(120).join("\n")).replace(/ +/g, " ")).toContain(
			"→ alt INT: 20-34 DEX: 2.1k/160/130 t/s { 29B / 29B } (family-b) [accelerator B] [test-router]",
		);
		selector.handleInput("\x15");
		selector.handleInput("INT: 9-14*");
		expect(stripAnsi(selector.render(120).join("\n"))).toContain(
			"→   東京🦆 INT: 9-14* { 2B / 2B } (unicode) [test-router]",
		);
		selector.handleInput("\x15");
		selector.handleInput("DEX: 2.1k/160/130");
		expect(stripAnsi(selector.render(120).join("\n"))).toMatch(/→ +alt +INT: 20-34 +DEX: 2\.1k\/160\/130 t\/s/);
		selector.handleInput("\r");
		expect(select).toHaveBeenCalledWith(models[1]);
		expect(models[1].id).toBe("alt");
	});

	it("recalculates columns from the visible page when a wider row scrolls out", async () => {
		harness = await createHarness({
			modelsJson: {
				providers: {
					"test-router": {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: Array.from({ length: 11 }, (_, i) => ({
							id: i === 0 ? "very-long-alias" : `m${i.toString().padStart(2, "0")}`,
							pickerOrder: i,
							pickerName: i === 0 ? "long model name" : "short",
							pickerIntelligence: i === 0 ? "9-14*" : "15*",
							pickerHardware: i === 0 ? "very long hardware label" : "gpu",
							pickerParams: { total: i === 0 ? 1000 : 2, active: 2 },
						})),
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const scope = runtime
			.getAvailableSnapshot()
			.filter((model) => model.provider === "test-router")
			.map((model) => ({ model }));
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			undefined,
			runtime,
			scope,
			() => {},
			() => {},
		);
		await vi.waitFor(() => expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed."));
		const before = stripAnsi(selector.render(120).join("\n"))
			.split("\n")
			.find((line) => line.includes("m01"))!;
		for (let i = 0; i < 10; i++) selector.handleInput("\x1b[B");
		const after = stripAnsi(selector.render(120).join("\n"))
			.split("\n")
			.find((line) => line.includes("m01"))!;
		expect(after.indexOf("{")).toBeLessThan(before.indexOf("{"));
		expect(after.indexOf("(")).toBeLessThan(before.indexOf("("));
		expect(after.indexOf("[")).toBeLessThan(before.indexOf("["));
		expect(after.indexOf("[test-router]")).toBeLessThan(before.indexOf("[test-router]"));
		expect(after.trim()).toBe("m01 INT: 15* { 2B / 2B } (short) [gpu] [test-router]");
		selector.dispose();
	});

	it("lists every catalog that failed to refresh", async () => {
		harness = await createHarness();
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: new Map([
				["openai", new Error("unavailable")],
				["anthropic", new Error("unavailable")],
			]),
		});

		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel(),
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		await vi.waitFor(() => {
			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("Could not refresh 2 model catalogs (openai, anthropic); showing cached models.");
		});
	});

	it("fits eleven ranked aliases at 24 rows and selects canonical IDs after searching", async () => {
		const remoteIds = ["orbit", "sun", "earth", "moon"];
		const localIds = ["sample", "edge-b", "alt", "edge-c", "edge-d", "edge-e", "edge-f"];
		harness = await createHarness({
			modelsJson: {
				providers: {
					remote: {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: remoteIds.map((alias, i) => ({ id: `canonical-${alias}`, pickerOrder: i })),
						modelOverrides: Object.fromEntries(
							remoteIds.map((alias) => [
								`canonical-${alias}`,
								{
									pickerAlias: alias,
									name: alias === "orbit" ? "sample" : alias,
									pickerGroup: "remote",
									pickerProviderOrder: 0,
									pickerIntelligence: "18-37",
									pickerParams: { total: "6-10T*", active: "???" },
									pickerDex: { prefill: null, code: { min: 55, max: 70 }, prose: 30 },
									pickerColors: [{ chars: alias.length, fg: "#FFFFFF", bg: "#000000" }],
								},
							]),
						),
					},
					local: {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "test-key",
						models: localIds.map((id, i) => ({
							id,
							pickerAlias: id,
							pickerGroup: "local",
							name: id === "sample" ? "orbit" : id,
							pickerOrder: i,
							pickerProviderOrder: -1,
						})),
					},
				},
			},
		});
		const runtime = harness.session.modelRuntime;
		const current = runtime.getModel("local", "sample")!;
		const selected = vi.fn();
		const tui = createFakeTui(24);
		const models = [
			...localIds.map((id) => runtime.getModel("local", id)!),
			...remoteIds.map((id) => runtime.getModel("remote", `canonical-${id}`)!),
		];
		const selector = new ModelSelectorComponent(
			tui,
			current,
			runtime,
			models.map((model) => ({ model })),
			selected,
			() => {},
			undefined,
			() => {},
			{ provider: "local", id: "sample" },
		);
		await vi.waitFor(() => expect(stripAnsi(selector.render(160).join("\n"))).toContain("Model catalogs refreshed."));
		const rows = selector
			.render(160)
			.map(stripAnsi)
			.filter((line) => /\[(remote|local)\]/.test(line));
		expect(rows.map((line) => line.slice(4).trim().split(/ +/)[0])).toEqual([...remoteIds, ...localIds]);
		expect(rows[4]).toContain("· default");
		const initial = selector.render(160).map(stripAnsi);
		const moonIndex = initial.findIndex((line) => /moon +INT:/.test(line));
		expect(initial[moonIndex + 1]).toBe("─".repeat(160));
		expect(initial[moonIndex + 2]).toMatch(/→ ✓ sample/);
		selector.handleInput("\x1b[A");
		expect(stripAnsi(selector.render(160).join("\n"))).toMatch(/→ +moon +INT:/);
		selector.handleInput("\x1b[B");
		expect(stripAnsi(selector.render(160).join("\n"))).toContain("→ ✓ sample");
		expect(selector.render(80).length).toBeLessThanOrEqual(21);
		expect(selector.render(80).every((line) => visibleWidth(line) <= 80)).toBe(true);
		// Shrinking must page; growing must restore all eleven without reopening.
		Object.assign(tui.terminal, { rows: 20 });
		expect(
			selector
				.render(160)
				.map(stripAnsi)
				.filter((line) => /\[(remote|local)\]/.test(line)),
		).toHaveLength(7);
		Object.assign(tui.terminal, { rows: 24 });
		expect(
			selector
				.render(160)
				.map(stripAnsi)
				.filter((line) => /\[(remote|local)\]/.test(line)),
		).toHaveLength(11);
		selector.handleInput("\t");
		expect(stripAnsi(selector.render(160).join("\n"))).toContain("Scope: all | scoped");
		selector.handleInput("\t");
		// Exact local matches stay highlighted below remote fuzzy matches.
		selector.handleInput("sample");
		const filtered = selector.render(160).map(stripAnsi);
		const remoteIndex = filtered.findIndex((line) => line.includes("[remote]"));
		const localIndex = filtered.findIndex((line) => line.includes("[local]"));
		expect(remoteIndex).toBeGreaterThan(-1);
		expect(localIndex).toBeGreaterThan(remoteIndex);
		expect(filtered[localIndex - 1]).toBe("─".repeat(160));
		expect(filtered[localIndex]).toContain("→ ✓ sample");
		selector.handleInput("\x15");
		selector.handleInput("orbit");
		expect(stripAnsi(selector.render(160).join("\n"))).toContain("orbit");
		expect(stripAnsi(selector.render(160).join("\n"))).toMatch(
			/→ +orbit +INT: 18-37 +DEX: \?\/55-70\/30 t\/s +\{ 6-10T\* \/ \?\?\? \}/,
		);
		selector.handleInput("\r");
		expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: "canonical-orbit", provider: "remote" }));
	});
});
