# MCP server capabilities

An MCP server capability is a manifest of type `mcp-server`
(`examples/mcp/example.yaml`). Instead of being installed as a skill,
plugin, or tool that an agent adapter wires in, it registers a server with
the Model Context Protocol runtime: any MCP-aware agent can then talk to it
through standard MCP tools.

## Exposing MCP servers via the mcp adapter

The mcp adapter (`src/adapters/mcp.ts`) is responsible for surfacing these
capabilities. `McpAdapter.install` resolves the server entry for the
capability - from the manifest's `permissions.mcp.command`/`args`/`url`,
or, for `type: mcp-server` capabilities, a default entry
(`command: mcp`, `args: [<capability id>]`) - and writes it into the
project's `.mcp.json`, falling back to `~/.config/mcp.json` when no project
config exists.

The remaining lifecycle maps onto MCP config flags:

- `install` registers the server entry (creating or updating the MCP config).
- `enable` / `activate` sets the server's `disabled: false`.
- `disable` / `deactivate` sets `disabled: true`.
- `uninstall` removes the server entry entirely.

## How install works

`skillrouter install ./examples/mcp/example.yaml` requires the capability
payload to contain the server implementation (the manifest points at it via
`resources`; a real package ships a runnable MCP server). Installed MCP
servers show up in `skillrouter status` and `skillrouter verify` like any
other capability. If the manifest does not declare a server entry (no
`command`/`url` under `permissions.mcp`), install fails with a message
explaining the requirement - the adapter will not guess an implementation.

## Enabling per agent

MCP servers are only usable when the mcp agent is enabled in your project
config. In `skillrouter.yaml`:

```yaml
agents:
  mcp: true
```

With `mcp` enabled, the adapter can detect MCP configs, sync server
entries, and activate `mcp-server` capabilities into connected MCP clients.
Other agents (opencode, claude, gemini, ...) can still be flagged as
`compatible` or `adaptable` for the same capability, but the actual server
registration goes through the mcp adapter.

## References

- `src/adapters/mcp.ts` - the adapter implementation.
- `docs/adapters/creating-an-adapter.md` - how adapters work and how to
  write your own.
- `docs/manifests/manifest-reference.md` - the full manifest schema,
  including `type: mcp-server` and `permissions.mcp`.