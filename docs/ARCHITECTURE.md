# AdMitra AI — Architecture Document

## Overview

AdMitra is an AI-powered creative agency that generates hyperlocal, culturally resonant advertising creatives for Indian brands. It combines a Claude Agent SDK backend, a React real-time frontend, and a skill-based agent architecture to orchestrate the end-to-end creative workflow — from brand research to multilingual ad generation.

```
                         AdMitra Architecture — High Level

  ┌──────────────────────┐      WebSocket (bidirectional)      ┌──────────────────────┐
  │                      │◄───────────────────────────────────►│                      │
  │   React Frontend     │      HTTP REST (upload, health)     │   Express Server     │
  │   (Vite, port 5173)  │◄───────────────────────────────────►│   (Node, port 3003)  │
  │                      │                                     │                      │
  └──────────────────────┘                                     └──────────┬───────────┘
                                                                          │
                                                               ┌──────────▼───────────┐
                                                               │                      │
                                                               │   Claude Agent SDK   │
                                                               │   (query + hooks)    │
                                                               │                      │
                                                               └──────────┬───────────┘
                                                                          │
                                                      ┌───────────────────┼───────────────────┐
                                                      │                   │                   │
                                               ┌──────▼──────┐    ┌──────▼──────┐    ┌───────▼─────┐
                                               │  Agent       │    │  FAL.ai     │    │  Kling AI   │
                                               │  Skills      │    │  (Images)   │    │  (Video)    │
                                               │  (.claude/)  │    │             │    │             │
                                               └─────────────┘    └─────────────┘    └─────────────┘
```

---

## 1. Server Architecture

The server is the orchestration layer. It hosts the Express HTTP API, the WebSocket real-time channel, and the Claude Agent SDK integration.

```
server/
├── sdk-server.ts                    # Entry point: Express + WebSocket + event wiring
├── lib/
│   ├── ai-client.ts                 # Claude SDK wrapper (hooks, AskUserQuestion, sessions)
│   ├── streaming.ts                 # Extracted streaming handler (block-level WS relay)
│   ├── websocket-handler.ts         # Generic WebSocket layer (session subscriptions)
│   ├── session-manager.ts           # Session state (pipeline stages, assets, persistence)
│   ├── instrumentor.ts              # Cost/event tracking per session
│   └── orchestrator-prompt.ts       # System prompt (creative director persona)
└── actions/
    ├── types.ts                     # ActionTemplate, ActionInstance, ActionResult types
    ├── index.ts                     # ActionsManager (auto-discovery, execution, JSONL logging)
    └── templates/
        ├── generate-ad.ts           # FAL.ai image generation template + handler
        └── generate-video-ad.ts     # Kling AI video generation template + handler
```

### Component Responsibilities

#### `sdk-server.ts` — Entry Point
- Creates Express app + HTTP server
- Initializes `WebSocketHandler` on the HTTP server
- Wires `aiClient.setBroadcast()` to forward SDK hook events to WebSocket
- Registers all WebSocket event handlers (`chat`, `continue`, `execute_action`, `question_answer`, etc.)
- Listens on `actionEmitter` for action proposals from PostToolUse hooks
- Serves static files: `/sessions` (generated assets), `/uploads` (user images), `/outputs` (legacy)
- REST endpoints: `/health`, `/upload`, `/sessions`, `/sessions/:id/pipeline`, `/sessions/:id/assets`

#### `ai-client.ts` — Claude SDK Wrapper
- Wraps the SDK's `query()` function with session management
- Uses **streaming input mode** (`async function*` generator) to yield `SDKUserMessage` objects
- Supports multimodal input (text + base64 images)
- Configures SDK options: `settingSources: ['project']`, `includePartialMessages: true`, `allowedTools`
- Creates three SDK hooks per session:
  - **PreToolUse** (Bash matcher): blocks direct `generate-image`/`generate-video` execution
  - **PostToolUse** (all tools): broadcasts `tool_complete` events + detects action proposals in Bash stdout
  - **Notification**: forwards agent status messages to WebSocket
- Implements **AskUserQuestion** flow via `canUseTool` callback:
  - Intercepts AskUserQuestion tool calls
  - Broadcasts questions to frontend via WebSocket
  - Awaits user answers (stored in `pendingQuestions` Map)
  - Returns `updatedInput` with answers to the SDK
- Manages `AbortController` per session for cancellation
- Exports singleton `aiClient` and `sessionManager`

#### `streaming.ts` — Stream Relay
- Single `handleSDKStreaming()` function replaces 3x duplicated streaming blocks
- Iterates `aiClient.queryWithSession()` async generator
- Handles SDK message types:
  - `stream_event` → extracts Claude API events (`content_block_start/delta/stop`, `message_start/stop`)
  - `assistant` → collects final text for completion event
  - `system` → forwards to WebSocket
  - `result` → builds completion event with cost, stats, pipeline status

#### `websocket-handler.ts` — WebSocket Layer
- Manages WebSocket connections with client IDs and session subscriptions
- Supports message types: `chat`, `continue`, `cancel`, `subscribe`, `execute_action`, `continue_action`, `question_answer`
- Broadcasts messages to all clients subscribed to a session
- Heartbeat/ping-pong for connection health
- Auto-subscribes clients to sessions on first `chat` message

#### `session-manager.ts` — Session State
- 4 pipeline stages: `initialized` → `generating` → `completed` → `error`
- 2 asset types: `ads` (images), `videoAds` (videos)
- Creates session directories: `sessions/{sessionId}/outputs/ads/`
- Guards pipeline initialization to preserve assets across chat turns
- Tracks SDK session IDs for conversation resumption
- Single singleton instance (imported by all modules)

#### `instrumentor.ts` — Cost Tracking
- Tracks input/output tokens, API calls, and cost per session
- Produces campaign reports with `totalCost_usd`
- Sent to frontend in the `complete` event

#### `orchestrator-prompt.ts` — System Prompt
- Defines the "AI Creative Director" persona
- Workflow: Research → Propose Direction → Draft Copy → Propose Action → Wait → Iterate
- Instructs the agent to use skills (ad-creative, action-proposer) and never run scripts directly
- Includes cultural adaptation guidelines for 9 Indian languages

### Actions System

The Action Instance Pattern is a human-in-the-loop approval gate for expensive API calls.

```
  Agent proposes action          User reviews & executes          Server runs script
  (via action-proposer)          (ActionCard in frontend)         (child process)
         │                              │                              │
         ▼                              ▼                              ▼
┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
│ PostToolUse hook │            │ execute_action   │            │ runScript()     │
│ detects JSON in  │───────────►│ WS message from  │───────────►│ npx tsx script  │
│ Bash stdout      │            │ frontend         │            │ as child process│
└─────────────────┘            └─────────────────┘            └────────┬────────┘
         │                              │                              │
         │ action_instance              │ action_start                 │ action_complete
         │ (WS to frontend)             │ action_progress              │ (WS to frontend)
         ▼                              ▼                              ▼
  Frontend shows                Server executes              Asset stored in
  ActionCard UI                 with context                 sessions/{id}/outputs/
```

#### Action Templates

| Template | Script | API | Output |
|----------|--------|-----|--------|
| `generate_ad` | `generate-image.ts` | FAL.ai (Flux) | `ad-{lang}-{ts}.png` |
| `generate_video_ad` | `generate-video.ts` | Kling AI | `video-ad-{lang}-{ts}.mp4` |

Templates are auto-discovered from `server/actions/templates/` at startup. Each file exports a `config` (ActionTemplate) and a `handler` function.

---

## 2. Agent Skill Architecture

The agent runs inside the Claude SDK with `cwd` pointing to `agent/`. Skills are loaded via `settingSources: ['project']` which reads `agent/.claude/`.

```
agent/
├── CLAUDE.md                           # Agent instructions (workflow, rules, available actions)
├── .claude/
│   ├── settings.json                   # Tool permissions (Bash, Read, Write, etc.)
│   └── skills/
│       ├── ad-creative/                # Creative direction skill
│       │   ├── SKILL.md                # Skill entry point (quick reference, workflow)
│       │   ├── presets/
│       │   │   ├── options.md          # 9 languages, 10 festivals, 6 business types, 4 formats
│       │   │   ├── festival-calendar.md # 2026 Indian festival calendar with dates & regions
│       │   │   └── creative-directions.md # 5 creative direction templates
│       │   └── prompts/
│       │       ├── ad.md               # AD_PROMPT template with placeholders
│       │       └── video-ad.md         # VIDEO_AD_PROMPT with 4 motion presets
│       ├── action-proposer/            # Action proposal skill
│       │   ├── SKILL.md                # Skill docs (command format, templates, rules)
│       │   └── propose-action.ts       # Script: validates & emits JSON to stdout
│       └── scripts/
│           ├── generate-image.ts       # FAL.ai integration (Flux model)
│           └── generate-video.ts       # Kling AI integration
```

### Skill: `ad-creative`

A knowledge-only skill (no executable scripts). Provides the agent with:

- **Language presets**: 9 Indian languages (Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, English) with script samples
- **Festival presets**: 10 festivals (Diwali, Sankranti, Pongal, Onam, etc.) with colors, motifs, and region mappings
- **Business type presets**: 6 types (jewelry, restaurants, clothing, etc.)
- **Creative direction templates**: 5 styles (Traditional Elegance, Modern Festive, Bold Sale, Emotional, Minimalist)
- **Prompt templates**: Structured image/video generation prompts with placeholders

The agent reads these files at runtime to inform creative decisions, then constructs generation prompts using the templates.

### Skill: `action-proposer`

The bridge between the agent and the human-in-the-loop action system.

**Flow**:
1. Agent calls the skill via Bash: `echo '<json>' | npx tsx .claude/skills/action-proposer/propose-action.ts --templateId generate_ad --label "..."`
2. `propose-action.ts` validates the templateId and params, generates a unique instanceId, and prints a JSON object to stdout
3. The PostToolUse hook in `ai-client.ts` intercepts the Bash output, parses the JSON (`type: "action_proposal"`), and emits it via `actionEmitter`
4. `sdk-server.ts` listens on `actionEmitter`, registers the instance in `ActionsManager`, and broadcasts `action_instance` to WebSocket
5. Frontend renders an `ActionCard` with editable parameters

**Why stdin?** Params are piped via stdin (not CLI `--params` arg) to avoid shell escaping issues with Unicode/Indic text (Telugu, Hindi, etc.) containing nested quotes and special characters.

### Scripts: `generate-image.ts` / `generate-video.ts`

Self-contained generation scripts that run as child processes:

- **generate-image.ts**: Calls FAL.ai's Flux model. Supports reference images (`--input`), aspect ratios, resolutions. Outputs PNG.
- **generate-video.ts**: Calls Kling AI. Takes a source image + motion prompt. Supports 5s/10s duration. Outputs MP4.

Scripts inherit environment variables from the parent process (no dotenv needed — `tsx --env-file=.env` loads them at server startup).

---

## 3. Frontend Architecture

React SPA with real-time WebSocket communication. Renders a chat-based interface for interacting with the AI creative agent.

```
frontend/
├── package.json                        # React 19 + Vite 7 + Tailwind v4 + Framer Motion
├── vite.config.ts                      # Proxy: /api, /outputs, /uploads, /sessions → port 3003
├── index.html                          # Instrument Serif + Inter fonts
└── src/
    ├── main.tsx                         # React entry point
    ├── index.css                        # "Premium White Studio" design system
    ├── App.tsx                          # Wires useWebSocket → AppShell → ChatView + ChatInput
    ├── lib/
    │   ├── types.ts                     # All TypeScript types (messages, actions, questions)
    │   └── api.ts                       # HTTP helpers (health check, image upload)
    ├── hooks/
    │   └── useWebSocket.ts              # Main WebSocket hook (state machine + message handlers)
    └── components/
        ├── layout/
        │   └── AppShell.tsx             # "AdMitra" branded header, white layout
        ├── ui/
        │   ├── Button.tsx               # Primary/secondary/ghost variants
        │   ├── IconButton.tsx           # Round icon buttons
        │   └── Spinner.tsx              # Saffron loading spinner
        └── chat/
            ├── ChatView.tsx             # Message list, welcome screen, suggestion chips
            ├── ChatInput.tsx            # Textarea + voice input + image upload
            ├── TextMessage.tsx          # User (saffron) / assistant (white) cards
            ├── ThinkingMessage.tsx      # Collapsible thinking with tool badges
            ├── ToolCallBlock.tsx        # Tool icon mapping
            ├── ToolUseBlock.tsx         # Expandable tool display
            ├── ActionCard.tsx           # Human-in-the-loop approval UI (editable params, CTA)
            ├── QuestionCard.tsx         # AskUserQuestion UI (option buttons, multi-select)
            ├── ImageMessage.tsx         # Rounded image with lightbox
            ├── ImageGrid.tsx            # Grid with language badges
            ├── VideoMessage.tsx         # Video player with label
            ├── VideoGrid.tsx            # Video grid layout
            ├── ProgressMessage.tsx      # Animated progress bar
            ├── ContinueButton.tsx       # Saffron pill button (post-action)
            └── VoiceInput.tsx           # Web Speech API (9 Indian languages)
```

### Design System: "Premium White Studio"

| Property | Value |
|----------|-------|
| Background | `#FFFFFF` (pure white) |
| Accent | `#D97706` (saffron) |
| Display Font | Instrument Serif |
| Body Font | Inter |
| Empty State | Rangoli pattern |
| Theme | Light only (no dark mode) |

### Component Hierarchy

```
App.tsx
└── AppShell
    ├── ChatView
    │   ├── Welcome Screen (empty state with rangoli + suggestion chips)
    │   ├── TextMessage (user / assistant)
    │   ├── ThinkingMessage
    │   │   └── ToolCallBlock / ToolUseBlock
    │   ├── ActionCard (with editable params + "Generate" CTA)
    │   ├── QuestionCard (AskUserQuestion options)
    │   ├── ImageMessage / ImageGrid
    │   ├── VideoMessage / VideoGrid
    │   ├── ProgressMessage
    │   └── ContinueButton
    └── ChatInput
        ├── Textarea
        ├── VoiceInput (Web Speech API)
        └── Image Upload
```

### `useWebSocket` Hook — State Machine

The central hook manages all WebSocket communication and UI state. It processes ~20 different server message types:

| Message Type | Handler Action |
|--------------|----------------|
| `session_init` | Store session ID |
| `block_start/delta/stop` | Accumulate streaming content blocks (text, tool_use, thinking) |
| `message_start/stop` | Mark message boundaries, finalize blocks |
| `tool_complete` | Clear activity indicator |
| `notification` | Set activity label from agent status |
| `ask_user_question` | Create QuestionCard message |
| `action_instance` | Defer ActionCard (added after text on `complete`) |
| `action_start` | Mark action as executing |
| `action_progress` | Update activity label |
| `action_complete` | Update action status, add image/video messages |
| `awaiting_continuation` | Show ContinueButton |
| `complete` | Extract final response, add deferred actions, reset state |
| `cancelled` / `error` | Reset generation state |

---

## 4. End-to-End Flow

### Full Creative Workflow

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ Frontend │                    │ Server  │                    │  Agent  │
│ (React)  │                    │(Express)│                    │ (Claude)│
└────┬─────┘                    └────┬────┘                    └────┬────┘
     │                               │                              │
     │ 1. User types brief           │                              │
     │   "Create Diwali ad for my    │                              │
     │    jewelry shop in Telugu"     │                              │
     │                               │                              │
     │──── WS: chat ────────────────►│                              │
     │     {content, images?}        │                              │
     │                               │                              │
     │                               │ 2. Create/resume session     │
     │                               │    Set up SDK hooks          │
     │                               │    Inject system prompt      │
     │                               │                              │
     │                               │──── SDK query() ────────────►│
     │                               │     (async generator)        │
     │                               │                              │
     │                               │                              │ 3. Agent researches
     │                               │                              │    Reads ad-creative
     │                               │                              │    skill presets
     │                               │                              │
     │                               │◄──── stream_event ──────────│
     │◄── WS: block_delta ──────────│     (thinking + tool calls)  │
     │    (real-time streaming)      │                              │
     │                               │                              │
     │                               │                              │ 4. Agent may ask
     │                               │                              │    clarifying questions
     │                               │                              │    via AskUserQuestion
     │                               │                              │
     │                               │◄──── canUseTool intercept ──│
     │◄── WS: ask_user_question ────│                              │
     │    {questionId, questions}    │                              │
     │                               │                              │
     │ 5. User answers questions     │                              │
     │──── WS: question_answer ─────►│                              │
     │    {questionId, answers}      │──── resolveQuestion() ──────►│
     │                               │    (unblocks canUseTool)     │
     │                               │                              │
     │                               │                              │ 6. Agent drafts copy
     │                               │                              │    in native Telugu
     │                               │                              │    Shows creative
     │                               │                              │    reasoning
     │                               │                              │
     │◄── WS: block_delta ──────────│◄──── stream_event ──────────│
     │    (thinking text)            │                              │
     │                               │                              │
     │                               │                              │ 7. Agent calls
     │                               │                              │    action-proposer skill
     │                               │                              │    via Bash
     │                               │                              │
     │                               │◄──── PostToolUse hook ──────│
     │                               │    (detects action_proposal  │
     │                               │     JSON in Bash stdout)     │
     │                               │                              │
     │                               │ 8. Server registers instance │
     │                               │    in ActionsManager         │
     │                               │                              │
     │◄── WS: action_instance ──────│                              │
     │    {template, params}         │                              │
     │                               │                              │
     │ 9. User reviews ActionCard    │                              │
     │    Modifies params if needed  │                              │
     │    Clicks "Generate"          │                              │
     │                               │                              │
     │──── WS: execute_action ──────►│                              │
     │    {instanceId, params}       │                              │
     │                               │ 10. Server executes action   │
     │                               │     Creates ActionContext     │
     │◄── WS: action_start ─────────│     Spawns child process:    │
     │                               │     npx tsx generate-image.ts│
     │◄── WS: action_progress ──────│         │                    │
     │                               │         │ FAL.ai API call    │
     │                               │         │ (~10-30 seconds)   │
     │                               │         ▼                    │
     │◄── WS: action_complete ──────│     Result: ad-telugu-*.png  │
     │    {artifact path}            │                              │
     │                               │ 11. Store asset in session   │
     │                               │     Convert path to URL      │
     │                               │                              │
     │ 12. Frontend shows image      │                              │
     │     + ContinueButton          │                              │
     │◄── WS: awaiting_continuation │                              │
     │                               │                              │
     │ 13. User clicks "Continue"    │                              │
     │──── WS: continue_action ─────►│                              │
     │                               │ 14. Build continuation msg   │
     │                               │     with action result       │
     │                               │                              │
     │                               │──── SDK query() ────────────►│
     │                               │    (resume session)          │
     │                               │                              │ 15. Agent sees result
     │                               │                              │     Comments on it
     │                               │                              │     Proposes next action
     │                               │                              │     (another language
     │◄── WS: block_delta ──────────│◄──── stream_event ──────────│      or video version)
     │                               │                              │
     │                     ... cycle repeats for each ad ...        │
     │                               │                              │
     │                               │◄──── result ────────────────│ 16. Agent done
     │◄── WS: complete ─────────────│                              │
     │    {costUsd, stats}           │                              │
     ▼                               ▼                              ▼
```

### Key Data Flows

#### A. Message Streaming (Server → Frontend)

```
  SDK query() yields messages
         │
         ▼
  handleSDKStreaming() iterates
         │
         ├── stream_event (type: content_block_start)  ──► WS: block_start
         ├── stream_event (type: content_block_delta)  ──► WS: block_delta   ──► useWebSocket handleBlockDelta()
         ├── stream_event (type: content_block_stop)   ──► WS: block_end     ──► useWebSocket handleBlockEnd()
         ├── stream_event (type: message_stop)         ──► WS: message_stop  ──► finalizeBlocksToMessage()
         ├── assistant (reconciliation checkpoint)     ──► collect text
         └── result                                    ──► WS: complete      ──► extract final TextMessage
```

#### B. Action Proposal Detection

```
  Agent runs Bash command:
  echo '{"prompt":...}' | npx tsx propose-action.ts --templateId generate_ad --label "..."
         │
         ▼
  propose-action.ts prints JSON to stdout:
  {"type":"action_proposal","instanceId":"action_xxx","templateId":"generate_ad",...}
         │
         ▼
  PostToolUse hook fires (ai-client.ts):
  parseActionProposal() finds JSON in Bash output
         │
         ▼
  actionEmitter.emit('proposal', {sessionId, proposal})
         │
         ▼
  sdk-server.ts listener:
  1. Register instance in ActionsManager
  2. Broadcast action_instance to WebSocket
         │
         ▼
  Frontend: useWebSocket stores as deferredAction
  (added to messages after complete event, so text appears first)
```

#### C. AskUserQuestion Flow

```
  Agent calls AskUserQuestion tool
         │
         ▼
  canUseTool callback (ai-client.ts) intercepts:
  1. Generate unique questionId
  2. Broadcast questions to frontend via WS: ask_user_question
  3. Store Promise resolver in pendingQuestions Map
  4. Await resolution (respects AbortSignal)
         │                                        │
         │                                        ▼
         │                               Frontend renders QuestionCard
         │                               User selects options / types answer
         │                                        │
         │                               WS: question_answer {questionId, answers}
         │                                        │
         ▼                                        ▼
  resolveQuestion() resolves Promise    sdk-server.ts routes to aiClient
         │
         ▼
  canUseTool returns {behavior: 'allow', updatedInput: {..., answers}}
         │
         ▼
  SDK continues with answers populated
```

#### D. Session Asset Pipeline

```
  sessions/{sessionId}/
  ├── outputs/
  │   └── ads/
  │       ├── ad-telugu-1739577600000.png     ← generate_ad output
  │       ├── ad-hindi-1739577700000.png      ← generate_ad output
  │       └── video-ad-telugu-1739577800000.mp4  ← generate_video_ad output
  └── {sessionId}.json                        ← session metadata

  Pipeline assets tracked in SessionManager:
  ├── ads: ["/abs/path/ad-telugu-*.png", "/abs/path/ad-hindi-*.png"]
  └── videoAds: ["/abs/path/video-ad-telugu-*.mp4"]

  Server converts absolute paths to URL-relative for frontend:
  /abs/path/sessions/xxx/outputs/ads/ad.png → sessions/xxx/outputs/ads/ad.png

  Frontend prepends "/" for display:
  /sessions/xxx/outputs/ads/ad.png

  Vite proxy (dev) or static serving (prod) routes to backend:
  GET /sessions/xxx/outputs/ads/ad.png → Express static middleware
```

---

## 5. SDK Integration Details

### Hook System

```
  ┌────────────────────────────────────────────────────────────────┐
  │                     Claude Agent SDK                           │
  │                                                                │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
  │  │  PreToolUse   │  │  PostToolUse  │  │  Notification        │ │
  │  │  (Bash only)  │  │  (all tools)  │  │  (agent status)      │ │
  │  │               │  │               │  │                      │ │
  │  │  Blocks:      │  │  Broadcasts:  │  │  Forwards:           │ │
  │  │  generate-    │  │  tool_complete│  │  title + message     │ │
  │  │  image.ts     │  │  to WebSocket │  │  to WebSocket        │ │
  │  │  generate-    │  │               │  │                      │ │
  │  │  video.ts     │  │  Detects:     │  │                      │ │
  │  │               │  │  action_      │  │                      │ │
  │  │  → Agent must │  │  proposal in  │  │                      │ │
  │  │  use action-  │  │  Bash stdout  │  │                      │ │
  │  │  proposer     │  │               │  │                      │ │
  │  └──────────────┘  └──────────────┘  └──────────────────────┘ │
  │                                                                │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  canUseTool (per-session)                                │  │
  │  │  ├── AskUserQuestion → intercept, broadcast, await       │  │
  │  │  └── All other tools → allow                             │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                │
  │  Options:                                                      │
  │  ├── settingSources: ['project']     (loads Skills, CLAUDE.md) │
  │  ├── includePartialMessages: true    (enables stream_event)    │
  │  ├── allowedTools: [Read, Write, Bash, Skill, AskUserQuestion] │
  │  ├── model: claude-opus-4-5                                    │
  │  └── maxTurns: 100                                             │
  └────────────────────────────────────────────────────────────────┘
```

### Streaming Input Mode

The SDK requires an `AsyncGenerator` when using MCP servers or multimodal input:

```
createPromptGenerator(prompt, imagePaths?, signal?)
  │
  ├── yield SDKUserMessage {type: "user", message: {role: "user", content}}
  │   └── content = string | [TextContentBlock, ImageContentBlock, ...]
  │
  └── await signal (keeps generator alive during tool execution)
```

---

## 6. WebSocket Protocol

### Client → Server Messages

| Type | Fields | Description |
|------|--------|-------------|
| `chat` | `content`, `sessionId?`, `images?` | Start new generation |
| `continue` | `sessionId`, `content?` | Continue conversation |
| `cancel` | `sessionId` | Cancel active generation |
| `subscribe` | `sessionId` | Subscribe to session events |
| `execute_action` | `sessionId`, `instanceId`, `params`, `originalParams` | Execute proposed action |
| `continue_action` | `sessionId`, `instanceId` | Continue after action completion |
| `question_answer` | `sessionId`, `questionId`, `answers` | Answer agent question |

### Server → Client Messages

| Type | Description |
|------|-------------|
| `connected` | WebSocket connection established |
| `session_init` | Session ID assigned |
| `block_start` | Content block begins (text, tool_use, thinking) |
| `block_delta` | Content block delta (streaming text or tool input JSON) |
| `block_end` | Content block finished |
| `message_start` | New assistant message begins |
| `message_stop` | Assistant message finished (with `stopReason`) |
| `tool_complete` | Tool execution finished (from PostToolUse hook) |
| `notification` | Agent status update (from Notification hook) |
| `ask_user_question` | Agent asking clarification questions |
| `action_instance` | Agent proposed an action (includes template + params) |
| `action_start` | Action execution began |
| `action_progress` | Action progress update |
| `action_complete` | Action finished (success/error, artifact paths) |
| `awaiting_continuation` | Waiting for user to continue |
| `complete` | Generation turn finished (cost, stats, pipeline) |
| `cancelled` | Generation was cancelled |
| `error` | Error occurred |

---

## 7. Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + `tsx` (direct TS execution, no build step) |
| Module System | ESM (`"type": "module"`) |
| AI | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| Image Gen | FAL.ai (Flux model) via `@fal-ai/client` |
| Video Gen | Kling AI (REST API) |
| HTTP | Express 4 |
| WebSocket | ws 8 |
| File Upload | Multer 2 |
| Frontend | React 19 + Vite 7 |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Voice | Web Speech API (browser-native) |

---

## 8. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Action Instance Pattern** (human-in-the-loop) | Expensive API calls (FAL.ai ~$0.04/image, Kling ~$0.10/video) need user approval before execution |
| **Process isolation** for generation scripts | Script crashes don't take down the agent session; long-running ops (Kling: 1-5 min) run independently |
| **Stdin JSON** for action-proposer | Shell escaping of Unicode/Indic text with nested quotes breaks CLI args |
| **PostToolUse hook** for proposal detection | SDK-native approach; parses action JSON from Bash stdout without modifying agent behavior |
| **Single ThinkingMessage** accumulator | All intermediate content (thinking + tool calls) goes into one collapsible message; final response extracted on `complete` |
| **Deferred ActionCard** rendering | ActionCard added to messages after `complete` event so text explanation appears before the action UI |
| **`settingSources: ['project']`** | Critical: without this, SDK loads zero skills, CLAUDE.md, or settings.json — entire skill architecture fails silently |
| **Session-scoped output paths** | Each session gets its own `outputs/ads/` directory; prevents cross-session file conflicts |
| **No structured outputs** | Incompatible with streaming; would block real-time UX |
| **No MCP tools** | Action Instance Pattern provides approval gate; MCP tools would let agent call APIs directly |
