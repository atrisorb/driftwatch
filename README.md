# driftwatch

Keeps you — and whichever LLM you're pairing with — aware of changelogs and breaking changes for the platforms/SDKs a project depends on, and checks whether an update actually touches that project's code.

## What it does

- Tracks RSS/Atom feeds, GitHub repo releases (`owner/repo` shorthand), npm packages, PyPI packages, or plain changelog pages (hash-watch fallback).
- Matches tracked platforms against a project's actual dependencies (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, ...).
- Surfaces new, relevant entries proactively: a `SessionStart` hook injects a digest, and a background monitor pushes mid-session notifications — no polling required from the user or the LLM.
- For breaking/deprecation/security entries, `assess_update` version-gates the change against the installed dependency version, greps the codebase for referenced symbols, and can optionally run the project's own build/test command — so the loop goes from "something changed" to "here's whether it affects you" in one step.
- `assess_update` also takes an optional `context`: what the user actually asked for or is working on (a task description, a file path, a symbol name). When given, the check is scoped to that instead of "does this appear anywhere in the repo", and a `runTests: true` run is scoped to the affected files' own tests when that mapping can be guessed (falls back to the full suite otherwise).
- Ships as a normal MCP server (`mcp/server.js`), so it works with any MCP-capable host; the Claude Code plugin wrapper (hook + monitor + skill) adds the proactive layer on top.

## Use as a Claude Code plugin

```
claude --plugin-dir ./driftwatch
```

Then, inside the session:

```
/driftwatch:platform-updates track the anthropic python sdk
```

or call the MCP tools directly (`add_platform`, `check_updates`, `get_digest`, `assess_update`, ...).

Quick start with a curated list of common platforms:

```
node bin/driftwatch import examples/starter-platforms.json
```

## Use standalone (any LLM / no Claude Code)

```
npm install
node mcp/server.js        # MCP server over stdio
# or
node bin/driftwatch list
node bin/driftwatch add "Stripe" stripe/stripe-node --type feed --detect stripe
node bin/driftwatch digest --project /path/to/your/project
```

## Storage

Everything lives under `${CLAUDE_PLUGIN_DATA}` when run as a plugin (survives plugin updates), or `~/.driftwatch` when run standalone: `platforms.json` (registry), `entries.json` (cached changelog entries, capped per platform), `digest-state.json` (what's already been shown to which project).
