# AdMitra Agent — Implementation Plan

## Context

We're building AdMitra — an AI creative agency agent for Indian small businesses — at `/Users/chakra/Documents/Agents/admitra-ai`. The server infrastructure uses Express + WebSocket + Claude Agent SDK streaming + Action Instance Pattern. No frontend in the initial build — server + agent only.

The previous session identified 7 contradictions in the existing ADMITRA_IMPLEMENTATION_PLAN.md and made key architectural decisions (detailed below). This plan resolves all contradictions and provides a clean build order.

Additionally, an SDK capability analysis was performed comparing this plan against the Claude Agent SDK's streaming responses, structured outputs, custom MCP tools, and hooks system. The findings are integrated below as changes to the relevant phases and documented in the Design Decisions section.

---

## Target Directory Structure

```
admitra-ai/
  .env / .env.example / .gitignore / CLAUDE.md
  package.json / tsconfig.json
  docs/
    PRD.md                             # Product requirements document
    IMPLEMENTATION_PLAN.md             # This file
  claude_sdk/                          # SDK reference documentation
  server/
    sdk-server.ts                      # Refactored: extracted handleSDKStreaming()
    lib/
      ai-client.ts                     # Adapted: SDK hooks, settingSources, includePartialMessages
      websocket-handler.ts             # Copied as-is (fully generic)
      session-manager.ts               # Simplified: AdMitra stages + assets
      orchestrator-prompt.ts           # NEW: AdMitra creative director prompt
      instrumentor.ts                  # Copied as-is (fully generic)
      streaming.ts                     # NEW: extracted handleSDKStreaming()
    actions/
      types.ts                         # Action system types (email-agent pattern)
      index.ts                         # ActionsManager: auto-discovery, execution, JSONL logging
      templates/                       # One file per action (auto-discovered)
        generate-ad.ts                 # config + handler for ad generation
        generate-video-ad.ts           # config + handler for video ad generation
  .logs/
    actions/                           # JSONL audit logs (one file per day)
  agent/
    CLAUDE.md
    outputs/ads/                       # Generated ad images and videos
    .claude/
      settings.json
      skills/
        ad-creative/                   # NEW: replaces editorial-photography
          SKILL.md
          presets/options.md
          presets/festival-calendar.md
          presets/creative-directions.md
          prompts/ad.md
          prompts/video-ad.md
        action-proposer/               # Adapted: updated VALID_TEMPLATES
          propose-action.ts
          SKILL.md
        scripts/                       # Copied: self-contained generation scripts
          generate-image.ts            # FAL.ai (dotenv import removed)
          generate-video.ts            # Kling AI (dotenv import removed)
  sessions/
  uploads/
```

---

## Phase 1: Scaffold New Repo

**Create:** `package.json`, `tsconfig.json`, `.env`, `.env.example`, `.gitignore`, `CLAUDE.md`, all directories

**package.json** — trimmed dependencies (no sharp, opencv-js, fluent-ffmpeg, zod, mediabunny, readable-stream, dotenv):
```json
{
  "name": "admitra-ai",
  "version": "1.0.0",
  "type": "module",
  "main": "server/sdk-server.js",
  "scripts": {
    "start": "tsx --env-file=.env server/sdk-server.ts",
    "dev": "tsx watch --env-file=.env server/sdk-server.ts"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.73",
    "@fal-ai/client": "^1.8.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "multer": "^2.0.2",
    "tsx": "^4.7.0",
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/multer": "^2.0.0",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.18.1",
    "typescript": "^5.3.3"
  }
}
```

**tsconfig.json** — copy from source as-is (ES2022, ESNext modules, strict)

**.env** — configure API keys. Port: 3003.

**Then:** `git init && npm install`

---

## Phase 2: Copy + Refactor Server Core (6 files)

### 2a. `websocket-handler.ts` — Generic WS layer (465 lines). Fully generic.

### 2b. `instrumentor.ts` — Event/cost tracking (394 lines). Fully generic.

### 2c. `session-manager.ts` — Simplified for AdMitra

Changes:
1. **PipelineStage**: `'initialized' | 'generating' | 'completed' | 'error'`
2. **PipelineAssets**: `{ ads: string[]; videoAds: string[] }` (replaces hero/contactSheet/frames/videos/finalVideo)
3. **createSessionDirectories**: only create `outputs/ads/` subdirectory
4. **addAsset**: simplify to `assetType: 'ad' | 'videoAd'`, push to appropriate array (no index param)
5. **getPipelineStatus**: 4 stages → `initialized:0, generating:50, completed:100, error:-1`
6. **updatePipelineStage**: update emoji map to match new stages

### 2d. `ai-client.ts` — SDK wrapper with hooks (408 lines)

Changes:
1. **[P0] Add `settingSources: ['project']`** to the `query()` options. Without this, the SDK loads zero filesystem settings — all Skills (ad-creative, action-proposer), CLAUDE.md files, and settings.json are invisible to the agent. The entire skill-based architecture fails silently without this.
2. **[P1] Add `includePartialMessages: true`** to the `query()` options explicitly. This enables the SDK to yield `SDKPartialAssistantMessage` objects (type `'stream_event'`) with proper metadata (`uuid`, `session_id`, `parent_tool_use_id`).
3. **[P1] Replace `BLOCKED_SCRIPTS` array with SDK `PreToolUse` hook.** Instead of maintaining a manual blocklist, use the SDK's hook system:
   ```typescript
   hooks: {
     PreToolUse: [{
       matcher: "Bash",
       hooks: [async (input) => {
         const command = (input as any).tool_input?.command || '';
         if (/generate-image|generate-video/.test(command)) {
           return {
             hookSpecificOutput: {
               hookEventName: 'PreToolUse',
               permissionDecision: 'deny',
               permissionDecisionReason: 'Direct script execution blocked. Use the action-proposer skill to propose generate_ad or generate_video_ad actions instead.'
             }
           };
         }
         return {};
       }]
     }]
   }
   ```
4. **[P1] Add `PostToolUse` hook for audit logging and WebSocket notification:**
   ```typescript
   PostToolUse: [{
     hooks: [async (input) => {
       const postInput = input as any;
       wsHandler.broadcast(sessionId, {
         type: 'tool_complete',
         tool: postInput.tool_name,
         result_preview: JSON.stringify(postInput.tool_response).substring(0, 500)
       });
       return {};
     }]
   }]
   ```
5. **[P1] Add `Notification` hook for forwarding agent status to WebSocket:**
   ```typescript
   Notification: [{
     hooks: [async (input) => {
       const notif = input as any;
       wsHandler.broadcast(sessionId, {
         type: 'notification',
         title: notif.title,
         message: notif.message
       });
       return {};
     }]
   }]
   ```
6. **[P1] Ensure `Skill` is included in `allowedTools`.** The SDK requires explicit permission for the Skill tool to invoke Skills.
7. Everything else (queryWithSession, session resume, multimodal file reading via `Read` tool) stays identical.

### 2e. `streaming.ts` — NEW (extracted from sdk-server.ts)
Extract the 3x duplicated streaming handler into a shared function:

```typescript
export async function handleSDKStreaming(
  queryIterator: AsyncGenerator,
  sessionId: string,
  wsHandler: WebSocketHandler,
  instrumentor: SDKInstrumentor,
  sessionManager: SessionManager
): Promise<{ assistantText: string; stopReason: string }>
```

Logic: iterate stream events, handle `content_block_start/delta/stop`, `message_start/stop`, collect assistant text, broadcast to WS. Identical to the existing blocks at lines ~267-389, ~433-564, ~826-942 of source sdk-server.ts.

**[P1] SDK-specific update:** Check for `message.type === 'stream_event'` (the SDK's `SDKPartialAssistantMessage` wrapper type) and use the metadata it provides:
- `message.uuid` — unique message identifier
- `message.session_id` — session tracking
- `message.parent_tool_use_id` — distinguish main agent vs subagent output (null = main agent)
- `message.event` — the raw Claude API `RawMessageStreamEvent`

Use the complete `AssistantMessage` (type `'assistant'`) yielded after each turn as a reconciliation checkpoint rather than relying solely on accumulated deltas.

### 2f. `sdk-server.ts` — Express + WebSocket entry point (989 lines)

Changes:
1. **Import** `handleSDKStreaming` from `./lib/streaming.js`
2. **Replace** 3 duplicated streaming blocks with calls to `handleSDKStreaming()`
3. **Health check**: `agent: 'admitra-ai'`
4. **execute_action handler**: update `assetTypeMap` to `{ generate_ad: 'ad', generate_video_ad: 'videoAd' }`
5. **Startup banner**: update to "AdMitra Agent Server"
6. **Port**: default 3003

---

## Phase 3: Action System + Executors (Improved)

> **Adopted from email-agent:** one-file templates (config + handler), auto-discovery, JSONL audit logging.
> Phase 3 and old Phase 4 are merged — action types, manager, and executors are all built together.

### 3a. `types.ts` — REWRITE

Defines the action system types. Adapted from email-agent pattern:

```typescript
// Pipeline stage (used by templates)
type PipelineStage = 'ad' | 'video';

// Template definition (config export in each action file)
interface ActionTemplate {
  id: string;                    // e.g. 'generate_ad'
  name: string;                  // e.g. 'Generate Ad'
  description: string;
  icon?: string;                 // e.g. '🎨'
  stage: PipelineStage;
  parameterSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;              // 'string', 'number', 'boolean'
      description: string;
      enum?: string[];
      default?: any;
      required?: boolean;
      advanced?: boolean;        // AdMitra-specific: collapsible in UI
    }>;
    required?: string[];
  };
  script: string;                // path to generation script
  outputPattern: string;         // e.g. 'outputs/ads/ad-{language}-{timestamp}.png'
}

// Instance (a specific proposal with filled-in params)
interface ActionInstance {
  instanceId: string;
  sessionId: string;
  templateId: string;
  label: string;
  params: Record<string, unknown>;
  timestamp: Date;
  status: 'pending' | 'executing' | 'completed' | 'error';
}

// Context passed to handler during execution
interface ActionContext {
  sessionId: string;
  cwd: string;
  outputDir: string;
  referenceImages: string[];
  getAsset: (type: 'ads' | 'videoAds') => string[] | null;
  getStage: () => PipelineStage;
  emitProgress: (stage: string, message: string, progress?: number) => void;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

// Result returned by handler
interface ActionResult {
  success: boolean;
  artifact?: string;
  artifacts?: string[];
  error?: string;
  message?: string;
  duration: number;
  retryable?: boolean;
}

// Pending continuation (waiting for user to click Continue)
interface PendingContinuation {
  sessionId: string;
  action: ActionInstance;
  result: ActionResult;
  userParamChanges?: Record<string, { from: unknown; to: unknown }>;
  timestamp: Date;
}

// Audit log entry (written to JSONL)
interface ActionLogEntry {
  timestamp: string;
  instanceId: string;
  templateId: string;
  sessionId: string;
  params: Record<string, unknown>;
  result: ActionResult;
  duration: number;
  error?: string;
}
```

### 3b. `index.ts` — REWRITE (ActionsManager with auto-discovery)

The ActionsManager replaces the old manual-registration pattern.

Key methods:
- **`loadAllTemplates()`** — scans `server/actions/templates/` for `.ts` files, dynamically imports each, validates `config.id` + `handler` function, registers them. Called once at startup.
- **`getTemplate(id)`** / **`getAllTemplates()`** — retrieve registered templates
- **`registerInstance(instance)`** / **`getInstance(id)`** — manage action instances
- **`executeAction(instanceId, params, context)`** — looks up instance + template, calls `handler(params, context)`, logs to JSONL, returns result
- **`logExecution(entry)`** — appends one line to `.logs/actions/{date}.jsonl`
- **`runScript(scriptPath, args, cwd)`** — spawns `npx tsx <script>` as child process, captures stdout/stderr, returns result.
- **`createActionContext(options)`** — factory for ActionContext
- **`setPendingContinuation()` / `getPendingContinuation()` / `clearPendingContinuation()`** — manage post-action continuation state
- **`buildContinuationMessage(continuation)`** — formats action result as message for Claude

### 3c. `templates/generate-ad.ts` — NEW (one-file template)

Config + handler in one file. Moved to `server/actions/templates/` for auto-discovery.

**Config:**
- **id**: `"generate_ad"`, stage: `"ad"`, icon: `"🎨"`
- **parameterSchema**: prompt (string, required), language (string, enum: 9 Indian languages), aspectRatio (string, enum: 1:1/9:16/3:4/16:9), resolution (string, enum: 1K/2K/4K), shopName (string, optional), festival (string, optional, advanced), useReferenceImages (boolean)
- **script**: `.claude/skills/scripts/generate-image.ts`
- **outputPattern**: `outputs/ads/ad-{language}-{timestamp}.png`

**Handler:**
1. `mkdirSync(outputs/ads, { recursive: true })` — ensure dir exists
2. Build output path: `ad-{language}-{timestamp}.png` (unique per call — fixes contradiction #4)
3. Build args: `--prompt`, `--output`, `--aspect-ratio`, `--resolution`, plus `--input` flags for reference images
4. Call `runScript()` with generate-image.ts
5. Return `{ success, artifact, duration }`

**shopName/festival**: kept in parameterSchema for ActionCard UI + logged in JSONL; Claude bakes them into the prompt text (resolves contradiction #7)

### 3d. `templates/generate-video-ad.ts` — NEW (one-file template)

**Config:**
- **id**: `"generate_video_ad"`, stage: `"video"`, icon: `"🎬"`
- **parameterSchema**: motionPrompt (string, required), language (string, enum: same 9), duration (string, enum: 5/10), negativePrompt (string, advanced, default: "blur, distort, low quality, text changing")
- **script**: `.claude/skills/scripts/generate-video.ts`
- **outputPattern**: `outputs/ads/video-ad-{language}-{timestamp}.mp4`

**Handler:**
1. `mkdirSync(outputs/ads, { recursive: true })` — ensure dir exists
2. Get most recent ad image from `context.getAsset("ads")` — error if none
3. Build output path: `video-ad-{language}-{timestamp}.mp4` (unique — fixes contradiction #4)
4. Build args: `--prompt`, `--input` (ad image), `--output`, `--duration`, `--negative-prompt`
5. Call `runScript()` with generate-video.ts
6. Return `{ success, artifact, duration }`

### Updated directory structure for actions:

```
server/actions/
  types.ts                        # Action system type definitions
  index.ts                        # ActionsManager (auto-discovery, execution, logging)
  templates/                      # One file per action (auto-discovered)
    generate-ad.ts                # config + handler for ad generation
    generate-video-ad.ts          # config + handler for video ad generation
.logs/
  actions/                        # JSONL audit logs (one file per day)
    2026-02-15.jsonl
```

---

## Phase 4: Copy Generation Scripts

### 4a. `generate-image.ts` — FAL.ai integration (278 lines)
Location: `agent/.claude/skills/scripts/generate-image.ts`
No dotenv import needed (tsx --env-file loads env vars, child inherits via process.env).

### 4b. `generate-video.ts` — Kling AI integration (396 lines)
Location: `agent/.claude/skills/scripts/generate-video.ts`
Same approach — no dotenv needed.

---

## Phase 5: Create Agent Skills

### 5a. `ad-creative/SKILL.md` — NEW
AdMitra-specific creative direction skill. Sections: overview, quick-match table (user intent -> presets), prompt templates (AD_PROMPT, VIDEO_AD_PROMPT), workflow steps, rules. NO references to generate_campaign (fixes contradiction #2).

### 5b. `ad-creative/presets/options.md` — NEW
9 language presets (Hindi through English) with script samples, 10 festival presets with colors/motifs, 6 business types, 4 ad format presets with aspect ratios.

### 5c. `ad-creative/presets/festival-calendar.md` — NEW
2026 Indian festival calendar with dates, regions, language mappings.

### 5d. `ad-creative/presets/creative-directions.md` — NEW
5 creative direction templates: Traditional Elegance, Modern Festive, Bold Sale, Emotional/Storytelling, Minimalist/Premium.

### 5e. `ad-creative/prompts/ad.md` — NEW
AD_PROMPT template with placeholders ({LANGUAGE}, {FESTIVAL}, {BUSINESS_TYPE}, etc.) and example.

### 5f. `ad-creative/prompts/video-ad.md` — NEW
VIDEO_AD_PROMPT template with 4 motion presets (product-focus, festive-energy, text-reveal, slow-pan).

### 5g. `action-proposer/propose-action.ts` — Action proposal bridge (128 lines)
`VALID_TEMPLATES`: `["generate_ad", "generate_video_ad"]`.

### 5h. `action-proposer/SKILL.md` — COPY + REWRITE
Rewrite to reference 2 AdMitra templates, AdMitra-specific examples, keep critical rules (explain reasoning, never run scripts directly, one action at a time).

### 5i. Agent config files
- `agent/CLAUDE.md` — project instructions for the Claude agent
- `agent/.claude/settings.json` — copy from source (tool permissions)

---

## Phase 6: Write Orchestrator Prompt

### `orchestrator-prompt.ts` — NEW (full rewrite)

AdMitra creative director persona. Key sections:
- Role: multilingual ad creative director for Indian small businesses
- 2 skills: ad-creative (presets/templates), action-proposer (propose actions)
- Workflow: understand business -> select presets -> draft copy in native language -> propose generate_ad -> wait -> adapt -> propose generate_video_ad
- Available Actions table: generate_ad, generate_video_ad (only 2)
- Rules: never run scripts directly, always propose via action-proposer, one action at a time
- No references to generate_campaign (contradiction #2)

---

## Phase 7: End-to-End Testing

1. **Server startup**: `npm run dev` -> verify health at `http://localhost:3003/health`
2. **Skills loading test**: verify that Skills are discovered by checking the SDK init message for available slash commands. If Skills don't appear, confirm `settingSources: ['project']` is set and `cwd` points to the agent directory.
3. **Script test**: run generate-image.ts directly with a test ad prompt
4. **Hook test**: verify `PreToolUse` hook blocks direct `generate-image.ts` / `generate-video.ts` execution via Bash, and that `PostToolUse` hook broadcasts tool completion events to WebSocket.
5. **Streaming test**: verify `includePartialMessages: true` yields `stream_event` messages with `uuid`, `session_id`, and `parent_tool_use_id` metadata.
6. **WebSocket test**: connect to `ws://localhost:3003/ws`, send chat message "Create a Diwali sale ad for my jewelry shop in Telugu", verify full flow: streaming -> action proposal -> execute -> artifact -> continue

---

## Design Decisions (SDK Analysis)

Decisions made after analyzing the Claude Agent SDK documentation against this implementation plan.

### Streaming input mode (AsyncGenerator) — Deferred

The SDK recommends streaming input mode (passing an `AsyncIterable<SDKUserMessage>` to `query()`) as the preferred approach. This enables inline image attachments, message queueing, interrupts, and is required for custom MCP tools.

**Decision: Keep string prompts for now.** The current approach of uploading files to disk and using Claude's `Read` tool to access them (including images — Claude is multimodal) works correctly. Streaming input mode is only needed for inline base64 image attachments in messages, which we don't use. This can be adopted later if we add MCP tools or need inline image support.

### Structured outputs — Rejected for interactive flow

The SDK's `outputFormat` option with JSON Schema can guarantee validated JSON output.

**Decision: Do not use for action proposals.** Three reasons:
1. **Incompatible with streaming** — when `outputFormat` is set, `StreamEvent` messages are not emitted. Users would see nothing until Claude finishes, breaking the real-time UX.
2. **Constrains only the final message** — action proposals happen mid-conversation, not at the end. Structured output forces the terminal response to be JSON.
3. **The skill-based approach works** — the action-proposer SKILL.md instructs Claude how to format proposals, and the server parses them.

**Future opportunity:** Structured outputs would work well for a "batch mode" API where a user submits a brief and receives a complete JSON creative package without real-time streaming.

### Custom MCP tools — Deferred

The SDK supports wrapping fal.ai and Kling AI as in-process MCP tools via `createSdkMcpServer()` + `tool()`.

**Decision: Keep `runScript()` + Action Instance Pattern.** Reasons:
1. **Human approval gate** — the action-proposer pattern puts a human in the loop before expensive API calls. MCP tools would let Claude call fal.ai directly without approval.
2. **Process isolation** — if a generation script crashes, it's isolated to the child process. An in-process MCP tool crash could take down the agent session.
3. **Long-running operations** — Kling video generation takes 1-5 minutes. During this time an in-process tool handler blocks the agent loop with no progress streaming. `runScript()` runs independently.
4. **Requires streaming input mode** — MCP tools mandate AsyncGenerator prompts, which would require refactoring `ai-client.ts`.

**Future opportunity:** If AdMitra adds an autonomous "campaign batch mode" where a brief produces multiple ads without per-action approval, MCP tools would be the right approach. Keep generation API logic cleanly separated from CLI argument parsing in the scripts for easy extraction later.

### SDK hooks vs manual event handling — Adopted (P1)

**Decision: Use SDK hooks for command blocking, tool auditing, and notification forwarding.** Hooks replace ~30-40% of manual event handling. The core text-streaming relay (iterating `content_block_delta` events) must remain manual since no hook fires on individual token deltas.

---

## Contradiction Resolution Summary

| # | Issue | Resolution | Phase |
|---|-------|------------|-------|
| 1 | Skill rename vs create new | Create new `ad-creative` skill | Phase 5 |
| 2 | Stale `CAMPAIGN_PROMPT` references | Removed all `generate_campaign` refs | Phase 5a, 6 |
| 3 | Missing `mkdirSync` in generate-ad.ts | Added at start of handler() | Phase 3c |
| 4 | Hardcoded output paths (overwrite issue) | `{language}-{timestamp}` in filenames | Phase 3c, 3d |
| 5 | index.ts listed as unchanged | Rewritten as ActionsManager with auto-discovery | Phase 3b |
| 6 | Frontend files listed as unchanged | Moot — no frontend in this build | N/A |
| 7 | festival/shopName defined but unused | Kept in parameterSchema + logged in JSONL | Phase 3c |

---

## SDK Integration Changes Summary

| Priority | Change | Phase | Impact |
|----------|--------|-------|--------|
| **P0** | Add `settingSources: ['project']` to query options | 2d | **Critical** — Skills, CLAUDE.md, settings.json all invisible without this |
| **P1** | Add `includePartialMessages: true` to query options | 2d | Enables proper SDK streaming metadata (`uuid`, `session_id`, `parent_tool_use_id`) |
| **P1** | Replace `BLOCKED_SCRIPTS` with `PreToolUse` hook | 2d | SDK-native command blocking, cleaner than manual array matching |
| **P1** | Add `PostToolUse` hook for audit + WS broadcast | 2d | Replaces manual tool-completion detection in streaming handler |
| **P1** | Add `Notification` hook for WS forwarding | 2d | Forwards agent status messages without manual event parsing |
| **P1** | Ensure `Skill` tool in `allowedTools` | 2d | Required for Skills to be invocable by the agent |
| **P1** | Update `handleSDKStreaming()` to use SDK message types | 2e | Use `message.type === 'stream_event'` and SDK metadata fields |
| **P2** | Streaming input mode (AsyncGenerator prompts) | Deferred | Not needed — file uploads work via disk + Read tool |
| **P2** | Structured outputs for action proposals | Rejected | Incompatible with streaming UX |
| **P2** | MCP tools for fal.ai/Kling | Deferred | Action Instance Pattern provides approval gate + process isolation |

---

## Phase 9: Bug Fixes — Path Architecture & Singleton Cleanup (Post-Implementation)

Four root-cause bugs discovered and fixed during E2E testing:

| Bug | Root Cause | Fix | Files |
|-----|-----------|-----|-------|
| Video gen "No ad images found" | `createSessionDirectories()` wiped `pipeline.assets` on every chat turn | Guard: `if (!session.pipeline)` | `session-manager.ts` |
| Action-proposer JSON failures | Shell escaping of Unicode/nested-quote JSON in `--params` CLI arg | Switched to stdin: `echo '{...}' \| npx tsx ...` | `propose-action.ts`, `SKILL.md` |
| Images not displaying | Templates wrote to `agent/outputs/ads/` instead of session dir; absolute paths sent to frontend | Templates use `context.outputDir`; server converts to URL-relative; added `/sessions` static serving + Vite proxy | `generate-ad.ts`, `generate-video-ad.ts`, `sdk-server.ts`, `vite.config.ts`, `ActionCard.tsx` |
| Duplicate startup log | Two `SessionManager` instances | Single singleton in `session-manager.ts`; `ai-client.ts` imports it | `session-manager.ts`, `ai-client.ts` |

---

## Key Project Files

| File | Purpose |
|------|---------|
| `server/sdk-server.ts` | Express + WebSocket entry point, `/sessions` static serving |
| `server/lib/ai-client.ts` | SDK wrapper with hooks (imports sessionManager singleton) |
| `server/lib/streaming.ts` | Extracted streaming handler |
| `server/lib/websocket-handler.ts` | Generic WS layer |
| `server/lib/session-manager.ts` | 4 stages, 2 asset types, single singleton owner |
| `server/lib/instrumentor.ts` | Event/cost tracking |
| `server/lib/orchestrator-prompt.ts` | Creative director system prompt |
| `server/actions/types.ts` | Action system types |
| `server/actions/index.ts` | ActionsManager (auto-discovery, JSONL logging) |
| `server/actions/templates/generate-ad.ts` | FAL.ai image generation (uses context.outputDir) |
| `server/actions/templates/generate-video-ad.ts` | Kling AI video generation (uses context.outputDir) |
| `agent/.claude/skills/ad-creative/` | Creative direction skill |
| `agent/.claude/skills/action-proposer/` | Action proposal bridge (stdin JSON) |
| `agent/.claude/skills/scripts/generate-image.ts` | FAL.ai script |
| `agent/.claude/skills/scripts/generate-video.ts` | Kling AI script |
| `frontend/vite.config.ts` | Proxy: /api, /outputs, /uploads, /sessions -> port 3003 |
