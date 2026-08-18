# Creating an Adapter

Adapters translate the universal capability model into what a specific agent consumes. This guide covers implementing a new `AgentAdapter` (for any member of the `AgentId` union) or replacing/adding an agent integration.

## The interface (`src/adapters/types.ts`)

```typescript
interface AgentAdapter {
  id: AgentId;                        // "opencode" | "gemini" | "claude" | "codex" | "aider" | "mcp" | "generic"
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

- `id` must be a member of the `AgentId` union (`src/core/types.ts`); a new agent id means extending the union first.
- Constructor takes a `DetectionContext` (`{ cwd, binaryPaths }`, from `src/adapters/env.ts`).

## What each method must do

- `detect()` → return `AgentInfo` (id, name, `detected`, `binaryPath`, `version`, notes). Prefer binary discovery from `ctx.binaryPaths` plus presence of the agent's known config dirs (see `detectByConfig`). Return `detected: false` gracefully when absent — the doctor depends on this.
- `discoverInstalled()` → scan the agent's own config locations for already-known capabilities and return `AdapterCapability[]` (`{ capabilityId, location, version, state }`). This feeds adoption of pre-existing skills.
- `install(cap, installRoot)` → expose the capability to the agent so it starts being loadable: typically **copy** the install root into the agent's skills directory, or symlink, or write a config entry. Return `{ agent, capabilityId, ok, action: "install", detail }`.
- `uninstall(capabilityId, installRoot)` → remove the exposure (delete the copied dir or config entry). Must be idempotent when nothing is exposed.
- `enable`/`disable` → mark as enabled/disabled in agent config where the agent distinguishes it (e.g. the MCP `disabled` flag).
- `activate`/`deactivate` → make it usable in the current session (or return the same as install/uninstall for simple adapters). Report `requiresRestart` when the agent needs it (see `GeminiAdapter`).

Never decide policy — policy lives in core. If an operation is unsupported for a given capability, throw the typed `AdapterError`; the runtime catches it and records a failure.

## Registering

```typescript
// Core never imports implementations; go through the registry.
const ctx: DetectionContext = { cwd, binaryPaths: await binaryDetected(ctx as any) };
const registry = await getAdapterRegistry(ctx);
registry.register(new MyAdapter(ctx));
```

- `AdapterRegistry` (`src/adapters/registry.ts`): `register`, `get` (throws `AdapterError` when missing), `has`, `all`, `ids`.
- `getAdapterRegistry` is a lazy **singleton** that already registers the five built-ins; `resetAdapterRegistry()` clears it for tests.
- Registration order matters only if two adapters share an id — ids are unique keys.

## Recommended patterns

- **Project-local exposure dirs.** Like `OpencodeAdapter` (`.opencode/skills`) and `ClaudeAdapter` (`.claude/skills`), expose under the project (ctx.cwd) with a user-level fallback (`~/.claude/skills`, `~/.config/opencode/skills`).
- **Avoid rewriting payloads (D-005).** Reuse the universal payload (`SKILL.md`, `resources/…`) from the install root as-is; generate agent-specific wrappers (`extension.yaml`, MCP config entries) only where the agent requires them. One install root serves many agents.
- **Name mapping.** Sanitize capability ids for directory names (`capabilityToSkillName` pattern: lowercase, non-`[a-z0-9-]` → `-`).
- **Discovery completeness.** Check for both `SKILL.md` and `skillrouter.yaml` presence so previously installed capabilities are recognized.
- **No secrets in logs.** Use the `logger` (`src/logging/logger.ts`) which redacts secret-shaped values.

## Testing

- Use temp directories: `node --test` with `mkdtemp`-style fixtures; see the existing `tests/adapters/*` for patterns (the suite is being built out).
- Construct a `DetectionContext` with a temp `cwd` and an empty `binaryPaths` map; test `detect` for both detected and not-detected cases.
- Assert install → discoverInstalled round-trips: after `install`, `discoverInstalled()` must return the capability with a resolvable `location`; `uninstall` must remove it.
- Assert idempotency of `uninstall`/`deactivate` on already-clean state.
- `npm run typecheck` must stay green; smoke checks `doctor`, `verify`, `self-test` should pass.

## Reference implementations

- `src/adapters/opencode.ts` — the most complete example: multi-location discovery, project-local install, sanitized names.
- `src/adapters/generic.ts` — the minimal/fastest example: everything maps to copying into `.agents/skills/<id>/`.
- `src/adapters/mcp.ts` — the config-entry pattern (enable/disable toggle a `disabled` flag) and `requiresRestart` semantics.
- `src/adapters/gemini.ts` — wrapper-generation pattern (writes `extension.yaml` referencing the reused payload).