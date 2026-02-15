# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Admitra is an AI agent backend built on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). It exposes an Express/WebSocket server that orchestrates Claude-powered agents with media generation capabilities (image via fal.ai, video via Kling AI).

## Commands

```bash
npm start        # Run server: tsx --env-file=.env server/sdk-server.ts
npm run dev      # Run with watch mode (auto-reload on file changes)
```

The server runs on port 3003 by default (configured in `.env`).

## Architecture

- **Entry point**: `server/sdk-server.ts` — Express + WebSocket server
- **Runtime**: Node.js with `tsx` for direct TypeScript execution (no build step needed)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Target**: ES2022, `outDir: ./dist`

### SDK Integration Pattern

This project uses the Claude Agent SDK's `query()` function with **streaming input mode** (async generator pattern), which is the recommended approach for interactive sessions. Key patterns:

- Use `async function*` generators to yield `SDKUserMessage` objects to `query()`
- Custom tools are defined via `createSdkMcpServer()` + `tool()` with Zod schemas
- MCP tool names follow the format: `mcp__{server_name}__{tool_name}`
- Custom MCP tools **require streaming input mode** — a plain string prompt won't work with `mcpServers`
- Session IDs come from the `system` init message (`message.type === 'system' && message.subtype === 'init'`)
- Use `resume` option with a session ID to continue conversations
- Set `permissionMode: 'bypassPermissions'` with `allowDangerouslySkipPermissions: true` for headless operation

### API Integrations

- **Anthropic (Claude)** — core agent via `ANTHROPIC_API_KEY`
- **fal.ai** — image generation via `FAL_KEY`
- **Kling AI** — video generation via `KLING_ACCESS_KEY` / `KLING_SECRET_KEY`

## SDK Documentation

Local SDK reference docs are in `claude_sdk/`. Key files:
- `typescript_sdk.md` — full TypeScript API reference (types, `query()`, `tool()`, message types)
- `custom_tools.md` — creating MCP tools with `createSdkMcpServer()`
- `streaming_input.md` — streaming vs single message input modes
- `session_management.md` — session resumption and forking
- `sdk_hosting.md` — production deployment patterns (ephemeral, long-running, hybrid)
- `permissions.md` — tool permission configuration
- `subagents.md` — launching specialized sub-agents

## Subagents

Custom agents live in `.claude/agents/`.

**MANDATORY**: Any task involving the Claude Agent SDK — including implementation, debugging, architecture decisions, troubleshooting, or investigating SDK behavior — **must** be routed through the `sdk-architect-analyst` subagent first. Do not attempt to implement or debug SDK-related functionality without consulting this agent. It reads the local `claude_sdk/` docs and provides verified, documentation-grounded guidance.
