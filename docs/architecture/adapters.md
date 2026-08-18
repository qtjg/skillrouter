# Adapters

Adapters are the only place agent-specific knowledge lives. The core (router, runtime, security) is provider-agnostic (D-004); adding a new agent means adding one adapter.

## The `AgentAdapter` interface — `src/adapters/types.ts`

```typescript
interface AgentAdapter {
  id: AgentId;
  detect(): Promise<AgentInfo>;
  discoverInstalled(): Promise<AdapterCapability[]>;
  install(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
  enable(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  disable(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
  activate(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  deactivate(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
}
```

- `detect()` — is the agent present? Returns `AgentInfo` (id, name, binary path, version, notes) using the shared `DetectionContext`.
- `discoverInstalled()` — capabilities the agent already knows about in its own config dirs (e.g. `.claude/skills/foo/SKILL.md`).
- `install`/`uninstall`, `enable`/`disable`, `activate`/`deactivate` — expose or remove the capability payload. `installRoot` is the installed capability dir (`.skillrouter/installed/<id>@<version>`); a null installRoot means the capability may be manifest-only.
- All lifecycle methods return `AdapterOperationResult` (`{ agent, capabilityId, ok, action, detail?, requiresRestart? }`).

The state machine lives in core (`src/core/lifecycle.ts`); adapters are "dumb executors" of exposure — they do not decide policy (D-007).

## AdapterRegistry — `src/adapters/registry.ts`

- `register(adapter)`, `get(id)` (throws `AdapterError` if unknown), `has(id)`, `all()`, `ids()`.
- `getAdapterRegistry(ctx)` — lazy singleton that registers the five built-in adapters (`OpencodeAdapter`, `ClaudeAdapter`, `GeminiAdapter`, `McpAdapter`, `GenericAdapter`); `resetAdapterRegistry()` for tests.
- The core never imports adapter implementations directly — it resolves through the registry, keyed by `AgentId`.

`AgentId` union (`src/core/types.ts`): `"opencode" | "gemini" | "claude" | "codex" | "aider" | "mcp" | "generic"`. Adapter ids must be members of this union.

## Built-in adapters

| Adapter | Target | Mechanism |
| --- | --- | --- |
| `opencode` (`src/adapters/opencode.ts`) | opencode | Exposes into project `.opencode/skills` (also recognizes `.claude/skills`, `.agents/skills`, user `~/.config/opencode/skills`, `~/.claude/skills`). Discovers dirs with `SKILL.md` or `skillrouter.yaml`. |
| `claude` (`src/adapters/claude.ts`) | Claude Code | `.claude/skills/<name>/SKILL.md` (project and `~/.claude/skills`), reusing the universal payload without conversion. |
| `gemini` (`src/adapters/gemini.ts`) | Gemini CLI | `~/.gemini/extensions/<name>/extension.yaml` with the skill payload under `skills/<id>/`; notes that Gemini requires a restart. |
| `mcp` (`src/adapters/mcp.ts`) | MCP clients | Configuration-based (D-015): writes/updates `.mcp.json` (project) or `~/.config/mcp.json` (user); enable/disable toggles the `disabled` flag on the server entry. No MCP client protocol in v0.1. |
| `generic` (`src/adapters/generic.ts`) | Any agent | The portable `.agents/skills` standard (see below); also the fallback/universal export target. |

Detection also covers `codex` and `aider` binaries (`binaryDetected`), but no dedicated adapters exist for them in v0.1 — the `generic` path applies.

## The generic `.agents/skills` portable standard

`GenericAdapter` installs into `.agents/skills/<id>/` (project) or `~/.agents/skills/` (user): a directory containing a `SKILL.md` markdown file. The universal payload is reused as-is — the capability author's `SKILL.md` at the capability root is the file that gets copied (D-005). The same payload works for opencode, Claude Code, and generic consumers, so one install root serves multiple agents without per-agent duplicates.

## DetectionContext — `src/adapters/env.ts`

```typescript
interface DetectionContext {
  cwd: string;
  binaryPaths: Map<string, string | null>;   // "opencode" → resolved path or null
}
```

`detectAll(cwd)` builds binary paths (`which` over opencode/claude/gemini/codex/aider), instantiates adapters, and returns per-agent `AgentInfo`. `detectByConfig` and `configRoot`/`stateRoot` helpers (XDG-aware) support config-file detection and path resolution.

## D-005: reuse universal payloads

Adapters must reuse a capability's native files (`SKILL.md`, `resources/…`) when the target agent supports the standard Agent Skills layout, and only generate agent-specific wrappers (Gemini `extension.yaml`, MCP config) where required. Never rewrite or fan out copies of the payload per agent; the install root (`<project>/.skillrouter/installed/<id>@<version>`) is the single source of truth. Existing exposure is removed by resolving the previously exposed directory and deleting it.

See [creating-an-adapter.md](../adapters/creating-an-adapter.md) for implementation details.