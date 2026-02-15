# AdMitra AI

AI-powered creative agency that generates hyperlocal, culturally resonant advertising creatives for Indian brands. Built on the Claude Agent SDK with real-time streaming via WebSocket.

## Architecture

```
┌──────────────────────┐      WebSocket       ┌──────────────────────┐
│   React Frontend     │◄────────────────────►│   Express Server     │
│   (Vite, port 5173)  │      HTTP REST       │   (Node, port 3003)  │
└──────────────────────┘◄────────────────────►└──────────┬───────────┘
                                                         │
                                              ┌──────────▼───────────┐
                                              │   Claude Agent SDK   │
                                              └──────────┬───────────┘
                                                         │
                                         ┌───────────────┼───────────────┐
                                         │               │               │
                                  ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼───────┐
                                  │ Agent Skills │ │  FAL.ai     │ │  Kling AI   │
                                  │ (.claude/)   │ │  (Images)   │ │  (Video)    │
                                  └─────────────┘ └─────────────┘ └─────────────┘
```

## Prerequisites

- **Node.js** >= 20 (tested with v23.7)
- **npm** >= 10
- **Claude Code CLI** — the Claude Agent SDK requires it. Install via:
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

## API Keys Required

| Key | Service | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Anthropic | Core AI agent (required) |
| `FAL_KEY` | fal.ai | Image generation (required for ad creation) |
| `KLING_ACCESS_KEY` | Kling AI | Video generation (optional) |
| `KLING_SECRET_KEY` | Kling AI | Video generation (optional) |

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/DV0x/admitra-ai.git
cd admitra-ai
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
FAL_KEY=your-fal-key-here
KLING_ACCESS_KEY=your-kling-access-key
KLING_SECRET_KEY=your-kling-secret-key
PORT=3003
NODE_ENV=development
CLAUDE_CODE_MAX_OUTPUT_TOKENS=16384
```

### 3. Install dependencies

```bash
# Install server dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 4. Run the app

You need two terminals — one for the backend, one for the frontend.

**Terminal 1 — Backend server:**

```bash
npm run dev
```

This starts the Express + WebSocket server on `http://localhost:3003` with auto-reload on file changes.

**Terminal 2 — Frontend dev server:**

```bash
cd frontend
npm run dev
```

This starts the Vite dev server on `http://localhost:5173` with hot module replacement. The frontend proxies API and WebSocket requests to the backend automatically.

### 5. Open the app

Visit **http://localhost:5173** in your browser.

## Project Structure

```
admitra-ai/
├── server/
│   ├── sdk-server.ts              # Entry point: Express + WebSocket server
│   ├── lib/
│   │   ├── ai-client.ts           # Claude SDK wrapper (hooks, sessions)
│   │   ├── streaming.ts           # SDK streaming handler (block-level WS relay)
│   │   ├── websocket-handler.ts   # WebSocket layer (session subscriptions)
│   │   ├── session-manager.ts     # Session state (pipeline, assets, persistence)
│   │   ├── instrumentor.ts        # Cost/event tracking per session
│   │   └── orchestrator-prompt.ts # System prompt (creative director persona)
│   └── actions/
│       ├── index.ts               # ActionsManager (auto-discovery, execution)
│       ├── types.ts               # ActionTemplate, ActionInstance types
│       └── templates/
│           ├── generate-ad.ts     # FAL.ai image generation action
│           └── generate-video-ad.ts # Kling AI video generation action
├── frontend/                      # React + Vite + Tailwind frontend
│   ├── src/
│   │   ├── components/chat/       # Chat UI components
│   │   ├── hooks/useWebSocket.ts  # WebSocket client hook
│   │   └── lib/types.ts           # Shared types
│   └── vite.config.ts             # Vite config with backend proxy
├── .claude/agents/                # Custom Claude agent definitions
├── claude_sdk/                    # Local SDK reference documentation
├── docs/                          # Additional documentation
├── package.json                   # Server dependencies & scripts
└── .env.example                   # Environment variable template
```

## Available Scripts

### Server (root)

| Command | Description |
|---------|-------------|
| `npm start` | Run server (production) |
| `npm run dev` | Run server with auto-reload (development) |

### Frontend (`frontend/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check + config status |
| `POST` | `/upload` | Upload reference images (max 10, 10MB each) |
| `GET` | `/sessions` | List active sessions |
| `GET` | `/sessions/:id` | Get session info |
| `GET` | `/sessions/:id/pipeline` | Get pipeline status |
| `GET` | `/sessions/:id/assets` | Get session assets |
| `POST` | `/sessions/:id/cancel` | Cancel active generation |

## WebSocket Protocol

Connect to `ws://localhost:3003/ws`. Messages are JSON.

**Client -> Server:**

| Type | Description |
|------|-------------|
| `chat` | Start a new conversation (`{ type, content, images? }`) |
| `continue` | Continue a session (`{ type, sessionId, content? }`) |
| `cancel` | Cancel generation (`{ type, sessionId }`) |
| `subscribe` | Subscribe to session events (`{ type, sessionId }`) |
| `execute_action` | Execute a proposed action (`{ type, instanceId, params }`) |
| `continue_action` | Continue after action completion (`{ type, instanceId }`) |
| `question_answer` | Answer an agent question (`{ type, questionId, answers }`) |

## How It Works

1. **User sends a message** via the chat UI (WebSocket `chat` event)
2. **Server creates a session** and starts the Claude Agent SDK `query()` with a creative director system prompt
3. **Claude agent streams responses** — thinking, text, tool calls — all relayed to the frontend in real-time via WebSocket
4. **Agent proposes actions** (e.g., "Generate Ad") which appear as interactive cards in the UI
5. **User reviews and executes actions** — parameters can be adjusted before execution
6. **Actions run server-side** (FAL.ai for images, Kling AI for video) with progress updates streamed to the frontend
7. **Agent continues** after action completion, using results to plan next steps

## Troubleshooting

- **"Claude Code CLI not found"** — Install it globally: `npm install -g @anthropic-ai/claude-code`
- **WebSocket connection failed** — Make sure the backend is running on port 3003 before starting the frontend
- **"ANTHROPIC_API_KEY missing"** — Check your `.env` file exists and has a valid key
- **Image generation fails** — Verify your `FAL_KEY` is set and valid
- **Port already in use** — Change `PORT` in `.env` or kill the process using the port

## License

Private — All rights reserved.
