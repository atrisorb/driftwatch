#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const store = require('../lib/store');
const check = require('../lib/check');
const digest = require('../lib/digest');
const impact = require('../lib/impact');
const testRunner = require('../lib/testRunner');
const { TYPES } = require('../lib/fetchers');

const TOOLS = [
  {
    name: 'list_platforms',
    description: 'List all tracked platforms/SDKs, with last-check time and how many changelog entries are cached for each.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_platform',
    description:
      'Subscribe to a platform\'s changelog. type "feed" accepts any RSS/Atom URL or a bare "owner/repo" GitHub shorthand (uses the repo\'s releases feed). type "npm"/"pypi" take a bare package name. type "url_watch" is a fallback for plain changelog pages with no feed. Runs an initial fetch immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable platform name, e.g. "Anthropic API"' },
        url: { type: 'string', description: 'Feed URL, "owner/repo", or bare package name depending on type' },
        type: { type: 'string', enum: TYPES },
        detect: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dependency identifiers (npm/pypi package names, "go"/"python"/"rust" language tags, etc.) that mark a project as using this platform. Omit for a platform that is always relevant.',
        },
      },
      required: ['name', 'url', 'type'],
    },
  },
  {
    name: 'remove_platform',
    description: 'Unsubscribe from a platform and drop its cached entries.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'check_updates',
    description: 'Force (or TTL-respecting) refresh of one or all tracked platforms. Returns newly discovered entries.',
    inputSchema: {
      type: 'object',
      properties: {
        platformId: { type: 'string', description: 'Check only this platform. Omit to check all.' },
        forceRefresh: { type: 'boolean', description: 'Ignore the per-platform TTL and refetch now. Default false.' },
      },
    },
  },
  {
    name: 'get_digest',
    description:
      'Get a short digest of new changelog entries relevant to a project (based on its dependencies), each tagged with severity and, for breaking/deprecation/security items, a cheap impact hint. Marks returned entries as shown for that project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Project directory. Defaults to current directory.' },
        maxItems: { type: 'number', description: 'Max entries to include. Default 8.' },
      },
    },
  },
  {
    name: 'search_changelog',
    description: 'Keyword search over cached changelog entries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        platformId: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'assess_update',
    description:
      'Assess whether a specific changelog entry actually affects a project: version-gates it against the installed dependency version, greps the codebase for referenced symbols (optionally scoped to what the user is currently asking about, via `context`), and optionally runs the project\'s own build/test command, scoped to the affected files\' tests when that mapping can be guessed. Returns verdict: affected | not-referenced | inconclusive.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string' },
        projectPath: { type: 'string', description: 'Project directory. Defaults to current directory.' },
        context: {
          type: 'string',
          description:
            'Free text describing what the user is currently asking/working on (a task description, mentioned file paths, symbol names). When given, this is checked against the codebase alongside the changelog entry itself, so the verdict reflects whether the update touches what the user actually cares about right now, not just "does it appear anywhere in the repo".',
        },
        runTests: { type: 'boolean', description: 'Also run the project\'s detected build/test command. Executes real commands in the project — ask the user before setting this true. Default false.' },
      },
      required: ['entryId'],
    },
  },
];

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function handleCall(name, args) {
  switch (name) {
    case 'list_platforms': {
      const platforms = store.getPlatforms();
      const entries = store.getEntries();
      return textResult(
        platforms.map((p) => ({
          ...p,
          cachedEntries: entries.filter((e) => e.platformId === p.id).length,
        }))
      );
    }

    case 'add_platform': {
      if (!TYPES.includes(args.type)) throw new Error(`type must be one of: ${TYPES.join(', ')}`);
      const id = store.makePlatformId(args.name, args.url);
      const platform = { id, name: args.name, url: args.url, type: args.type, detect: args.detect || [] };
      store.upsertPlatform(platform);
      const result = await check.checkPlatform(store.getPlatform(id), { force: true });
      return textResult({ platform: store.getPlatform(id), initialFetch: result });
    }

    case 'remove_platform': {
      store.removePlatform(args.id);
      return textResult({ removed: args.id });
    }

    case 'check_updates': {
      if (args.platformId) {
        const platform = store.getPlatform(args.platformId);
        if (!platform) throw new Error(`unknown platform: ${args.platformId}`);
        const result = await check.checkPlatform(platform, { force: !!args.forceRefresh });
        return textResult({ [args.platformId]: result });
      }
      const results = await check.checkAll({ force: !!args.forceRefresh });
      return textResult(results);
    }

    case 'get_digest': {
      const result = digest.buildDigest({ projectPath: args.projectPath, maxItems: args.maxItems });
      return textResult(result);
    }

    case 'search_changelog': {
      const q = args.query.toLowerCase();
      const matches = store
        .getEntries()
        .filter((e) => (!args.platformId || e.platformId === args.platformId))
        .filter((e) => `${e.title} ${e.summary}`.toLowerCase().includes(q))
        .slice(0, 30);
      return textResult(matches);
    }

    case 'assess_update': {
      const entry = store.getEntry(args.entryId);
      if (!entry) throw new Error(`unknown entry: ${args.entryId}`);
      const platform = store.getPlatform(entry.platformId);
      const assessment = impact.assessImpact(entry, platform, args.projectPath, args.context);
      let testResult = null;
      if (args.runTests) {
        const focusPaths = Array.from(new Set(assessment.references.map((r) => r.file)));
        testResult = await testRunner.runCommand(args.projectPath, { focusPaths });
      }
      return textResult({ entry, ...assessment, testResult });
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function main() {
  const server = new Server({ name: 'driftwatch', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await handleCall(request.params.name, request.params.arguments || {});
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('driftwatch mcp server failed:', err);
  process.exit(1);
});
