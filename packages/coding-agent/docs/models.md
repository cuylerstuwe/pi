# Choose a Model

For a built-in provider, start with `/login`, then choose a model with `/model`. Use custom model configuration only when Pi does not already include the provider or endpoint you need.

## Choose a connection

| What you have | Recommended setup |
|---|---|
| A supported subscription | Sign in through `/login` |
| A provider API key | Store it through `/login` or set its environment variable |
| A local GGUF model | Connect Pi to the llama.cpp router |
| An OpenAI-, Anthropic-, or Google-compatible endpoint | Add it to `models.json` |
| A provider with a custom protocol or authentication flow | Build or install a provider extension |

Browse the [model catalog](https://pi.dev/models) for current providers, model IDs, capabilities, context limits, and pricing. Pi starts with its bundled catalog and can overlay newer catalog data from pi.dev. Cached catalog data remains available offline; run `pi update --models` to force a refresh.

## Authenticate

Run `/login` and select a provider. Pi stores credentials in [`auth.json`](configuration.md#agent-directory). Run `/logout` to remove stored credentials for a provider.

You can instead provide an API key through the provider's environment variable. This is useful in CI and other environments where Pi should not write credentials. [Provider Authentication](providers.md) lists the variables and cloud-provider setup.

When several credential sources are configured, Pi uses a runtime `--api-key` first, then a stored `auth.json` credential, an `apiKey` from `models.json`, and finally the provider's environment variables or ambient cloud credentials. Provider extensions can define their own authentication behavior.

Keep `auth.json` and any credential commands private. Project settings and extensions can execute inside the Pi process after you trust a project. Review [Security](security.md) before loading configuration from an untrusted directory.

## Select a model

Run `/model` to search available models. The picker shows models whose providers have usable authentication. Press `Ctrl+S` on a model to save it as the default for new sessions.

Run `/thinking` to select the thinking level for the current model. Press `Ctrl+S` there to save the startup level. Pi limits the choices to levels supported by the selected model.

`Ctrl+P` cycles through available models. Use `/scoped-models` to control that cycle and save the selection, or configure model patterns through [Settings](settings.md#model-cycling).

A session records model and thinking-level changes. Resuming the session restores them without changing defaults for new sessions.

## Connect local models

Pi integrates directly with the llama.cpp router. The router discovers GGUF files and loads models on demand. Pi's `/llama` command manages the router, while `/model` selects one of its loaded models.

Follow [Local Models with llama.cpp](llama-cpp.md) for server startup, model layout, downloads, and connection troubleshooting.

For Ollama, LM Studio, vLLM, SGLang, and other compatible servers, [configure a compatible endpoint](#configure-a-compatible-endpoint) in `models.json`.

## Configure a compatible endpoint

Use [`models.json`](configuration.md#agent-directory) when an endpoint speaks an API Pi already supports. This includes most Ollama, LM Studio, vLLM, SGLang, and proxy deployments.

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

The dummy key makes the model available to Pi; Ollama ignores it. For an authenticated endpoint, `apiKey` and header values can use `$NAME` or `${NAME}` environment interpolation, a literal value, or a leading `!command`. Commands in `models.json` run at request time and are not cached by Pi.

Opening `/model` reloads the file. A `models` entry adds or replaces a model with the same ID on that provider. Use `modelOverrides` to change metadata for an existing built-in or extension-provided model without replacing the provider's model list. Unknown override IDs are ignored.

### Customize picker rows

All picker metadata is optional. No picker-specific configuration, extension, model alias, or provider is required. Unconfigured models keep their canonical ID and provider label, default colors, and normal selection behavior. Missing columns remain blank; columns absent from every visible row are omitted. Newly discovered models use the same defaults. Without ordering metadata, the existing current/default/provider ordering is preserved in the full list and the supplied order is preserved in the scoped list.

Set `pickerAlias` for a display/search-only alias such as `orbit`; API requests, selection callbacks, and sessions retain the canonical model ID. Set `pickerProviderOrder` on models to rank provider groups before current/default priorities. The lowest configured value in a provider wins; unranked providers follow.

Set `pickerName` to show a short model name between its ID and provider, for example `alt (example 27b) [example-router]`. This name is searchable in the picker. The full `name` remains in the detail below the list, and requests still use `id`.

Set `pickerGroup` to `"local"` for locally served models or `"remote"` for remote services (the default). Remote results always appear above local results, with a horizontal rule where both sections are visible. This applies during search and in both scopes; search still highlights its best match, and the rule is not selectable. Provider priorities and model order apply within these sections.

Set `pickerOrder` to arrange models within a provider, with lower numbers first and unranked models last. This takes precedence over moving the current or default model to the top of that provider's list. Search results still rank by relevance. These fields affect only the picker; they can be set in `models`, `modelOverrides`, or extension model definitions.

```json
{
  "id": "alt",
  "pickerName": "example 27b",
  "pickerHardware": "accelerator B",
  "pickerOrder": 3,
  "pickerIntelligence": "20-34",
  "pickerDex": { "prefill": 1100, "code": 60, "prose": 30 },
  "pickerParams": { "total": 27, "active": 27 },
  "pickerColors": [{ "chars": 3, "fg": "#080808", "bg": "#DDBB44" }]
}
```

`pickerIntelligence` adds a searchable `INT:` column immediately after the alias. Store the score as text, for example `"42"`, `"20-34"`, or `"9-14*"`; ranges and estimate markers display unchanged. Omit it when no score is available.

`pickerDex` adds a searchable `DEX: 1.1k/60/30 t/s` column immediately after intelligence. Supply measured positive tokens-per-second values in prefill, code generation, and prose generation order. Prefill values above 1000 display in thousands with one decimal place, for example `2702` becomes `2.7k` and a `26317`–`36038` range becomes `26.3k-36.0k`. Other values round to whole numbers. Stored measurements retain their full precision; picker search uses the displayed form. A component may instead be an observed range, for example `{ "min": 55, "max": 70 }`, rendered as `55-70`. Use `null` for an unavailable component, rendered as `?`, for example `DEX: ?/60/30 t/s`. Omit it until measurements are available.

`pickerParams` contains total and active parameters in billions and renders as `{ 27B / 27B }` after throughput and before the model name. Numeric values are billions. Strings display verbatim, for example `{ "total": "3-5T*", "active": "???" }`. Counts are searchable. Use equal values for dense models and omit the field when counts are unknown.

Individual `pickerDex` and `pickerParams` members may be omitted; missing members display as `?`. For example, `"pickerDex": { "code": 60 }` renders `DEX: ?/60/? t/s`, and `"pickerParams": { "total": 27 }` renders `{ 27B / ? }`. These are user-supplied reference measurements and labels; the picker does not benchmark models or measure live generation or prefill.

`pickerHardware` adds a searchable serving-hardware label between the model name and provider, for example `[accelerator B]`. Store the label without brackets. Omit it when the hardware is unknown.

`pickerColors` styles consecutive runs of the display alias (or ID when no alias is set) without changing its text. Each run specifies a positive `chars` count (Unicode graphemes), a foreground `fg`, and an optional background `bg`, using `#RRGGBB` colors. Uncovered characters use the default foreground; runs beyond the end have no visible effect. For multiple colors, add more runs. Colors remain stable while browsing; the arrow and checkmark indicate selection and the current model.

Alias, intelligence, DEX throughput, parameter counts, short name, serving hardware, provider, and default marker align in columns sized to the currently visible rows. Widths update after searching or scrolling. Columns without values are omitted. Long rows truncate to the terminal width instead of wrapping; the selected model's full name remains below the list. The compact picker adjusts its visible row count to terminal height; eleven models fit at 24 rows. Set `enabledModels` in settings to curate the initial scoped list; Tab still opens the full catalog. These display fields also work in `modelOverrides` and extension model definitions and are not added to inference requests.

### Describe model input and caching

Use `inputLimits.images.resize` to control how Pi encodes new image attachments, `read` results, and tool-result images before storing them in conversation history:

```json
{
  "id": "vision-model",
  "input": ["text", "image"],
  "inputLimits": {
    "images": {
      "resize": {
        "maxWidth": 1568,
        "maxHeight": 1568,
        "maxBytes": 524288,
        "jpegQuality": 75
      }
    }
  }
}
```

`maxBytes` limits the base64-encoded payload. Omitted resize fields use conservative defaults of 2000 by 2000 pixels, 4.5 MiB encoded, and JPEG quality 80. Images are encoded once; changing models does not rewrite historical images. The catalog can also describe hard request limits with `inputLimits.maxRequestBytes`, `images.maxPerMessage`, and `images.maxPerRequest`, but Pi does not yet rewrite or reject history based on them.

<a id="prompt-cache-lifetimes"></a>

Use `promptCache` to declare the provider's best-effort cache lifetime in seconds for the `short` or `long` retention tier:

```json
{ "id": "claude-sonnet-5", "promptCache": { "short": 300, "long": 3600 } }
```

Choose the conservative end of any published range. A model without a lifetime for the active tier is not eligible for cache warming. A `modelOverrides` entry can set `inputLimits` or `promptCache` for a built-in or extension model, including a model accessed through a validated proxy. See [`cacheWarming`](settings.md#model-and-thinking).

Compatibility settings should describe verified differences in the endpoint's request or response behavior. Do not enable them based only on an endpoint advertising OpenAI or Anthropic compatibility.

## Add a custom provider

Use an extension when the provider needs custom streaming, model discovery, or authentication behavior. See [Custom Providers](custom-provider.md) for the extension workflow.

## Troubleshooting

### A model does not appear

Confirm that its provider has usable authentication. Custom models can load from `models.json` but remain unavailable in `/model` until Pi can resolve credentials. For llama.cpp, only models currently loaded by the router appear.

### Authentication works in one shell only

Check whether the key came from an environment variable rather than `auth.json`. Environment variables must be present in the process that starts Pi.

### Sign-in opens a browser on a remote machine

Complete the provider's headless authentication flow when available. Some providers let you paste the final redirect URL or authorization code back into Pi. See [Authenticate interactively](providers.md#authenticate-interactively).

### A compatible endpoint rejects requests

Check its API type and compatibility settings in `models.json`. The upstream server must support the corresponding request fields and behavior.
