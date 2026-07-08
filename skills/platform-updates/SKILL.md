---
description: Track changelogs/breaking changes for platforms and SDKs the user depends on, guide adding new platforms, and check whether a specific update actually affects the current project. Use when the user wants to subscribe to a platform's changelog, asks "did X release anything breaking", reacts to a driftwatch notification, or is about to upgrade a dependency.
---

driftwatch tracks changelogs for platforms/SDKs and tells you whether an update actually touches the current codebase. Tools come from the bundled `driftwatch` MCP server.

## Adding a platform

**Manual** (user already gave you name + URL/type): call `add_platform` directly.

**Guided** (user just names a platform, e.g. "track Stripe"): use `AskUserQuestion` to nail down:
1. Feed type: a GitHub repo (`owner/repo` is enough — driftwatch uses its releases feed), an RSS/Atom URL, an npm package name, a PyPI package name, or "just a changelog webpage" (`url_watch`, last resort — no structured diff, only "page changed").
2. Which of the user's dependencies should mark this platform as relevant (the `detect` list — npm/pypi package names, or a language tag like `python`/`go`/`rust`). If the platform is something the user always wants to hear about, `detect` can be left empty.

If the user only gives a name with no URL, use `WebSearch` to find the project's changelog/releases page or GitHub repo before calling `add_platform`. Prefer a GitHub repo or RSS feed over `url_watch` whenever one exists — it's the only type with structured content.

`examples/starter-platforms.json` in this plugin has a small curated list (Anthropic, OpenAI, Node.js, npm, Next.js, Vercel...) — offer `driftwatch import <path>` when the user wants a quick baseline instead of adding platforms one by one.

## Reacting to updates

When `get_digest` or a driftwatch monitor notification surfaces an entry tagged `breaking`, `deprecation`, or `security`:
1. Call `assess_update` with `runTests: false` first — it's cheap (grep + version check only) and tells you `affected` / `not-referenced` / `inconclusive`.
2. **Always pass `context`** when you have one: a short description of what the user actually asked for or is currently working on (their request, the file/feature they're touching, symbol names). This isn't optional flavor — without it, `assess_update` can only tell you "this appears somewhere in the repo"; with it, the grep also runs against that context and `matchesContext: true` in the result tells you the update specifically touches what the user cares about right now, not just some unrelated corner of the codebase.
3. Summarize the verdict for the user in one line, don't dump the raw JSON. Lead with `matchesContext` when true — that's the actionable case.
4. Only propose `runTests: true` (it executes the project's real build/test command, scoped to the affected files' tests when driftwatch can find them) — ask the user before running it, even though it doesn't modify anything, since it can be slow or have side effects (e.g. hitting a dev server, network calls in tests). Check `testResult.scoped` to know whether it ran the whole suite or just the related tests.

Don't re-fetch on every single question — `check_updates` respects a per-platform TTL by default; only pass `forceRefresh: true` when the user explicitly wants a fresh check right now.
