# Cloudflare Deployment Guide — Admitra AI

## Architecture Overview

```
Browser (React SPA)
  │
  ├── /*            → Cloudflare Worker → Static Assets (frontend/dist/)
  │
  ├── /api/*        → Worker → Container.fetch() → Express:3003
  ├── /ws           → Worker → Container.fetch() → WebSocket Server:3003
  ├── /upload       → Worker → Container.fetch() → Express/multer
  ├── /sessions/*   → Worker → Container.fetch() → Express
  ├── /uploads/*    → Worker → Container.fetch() → Express static files
  └── /outputs/*    → Worker → Container.fetch() → Express static files
```

**Three components:**
1. **Cloudflare Worker** — Entry point. Routes requests to static assets or container.
2. **Cloudflare Container (Durable Object)** — Runs the full Node.js backend (Express + WebSocket + Claude SDK) inside a Docker container.
3. **Static Assets** — Serves the production-built React frontend.

### Why Containers (not Workers directly)

The backend uses:
- `@anthropic-ai/claude-agent-sdk` which spawns child processes
- Filesystem APIs (`fs/promises`) for sessions, uploads, outputs
- `multer` for file upload handling
- Long-running WebSocket connections
- `tsx` for TypeScript execution

None of these work in Workers V8 isolates. Containers give us a full Node.js runtime inside a Docker container managed by a Durable Object.

### Why Containers (not Sandbox SDK)

Both are built on Durable Objects, but:
- **Containers**: `container.fetch(request)` proxies both HTTP AND WebSocket natively
- **Sandbox SDK**: Only has `wsConnect()` for WebSocket; no HTTP proxy method

Containers is the right primitive for running a web server.

---

## Prerequisites

- Node.js 20+
- npm
- A Cloudflare account (free tier works for testing)
- `wrangler` CLI (installed in Step 1)

---

## Step 1: Install Dependencies

```bash
# From project root
npm install -D wrangler @cloudflare/workers-types @cloudflare/containers
```

This adds:
- `wrangler` — Cloudflare CLI for deployment
- `@cloudflare/workers-types` — TypeScript types for Workers runtime
- `@cloudflare/containers` — Container class for Durable Object containers

---

## Step 2: Create `Dockerfile`

Create `Dockerfile` in the project root:

```dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files first (Docker layer caching)
COPY package.json package-lock.json ./

# Install production dependencies only
# tsx is in dependencies (needed for runtime TypeScript execution)
RUN npm ci --production

# Copy server source code
COPY server/ ./server/

# Copy agent directory (Claude SDK reads .claude/ settings from here)
COPY agent/ ./agent/

# Copy TypeScript config
COPY tsconfig.json ./

# Create data directories
RUN mkdir -p /app/sessions /app/uploads /app/agent/outputs

# Expose the Express server port
EXPOSE 3003

# Start the server
CMD ["npx", "tsx", "server/sdk-server.ts"]
```

**What's included:**
- `server/` — Express + WebSocket backend
- `agent/` — Agent skills, scripts, and `.claude/` config (required by Claude SDK)
- `tsconfig.json` — TypeScript config for tsx

**What's NOT included (intentionally):**
- `frontend/` — Served as static assets by the Worker, not the container
- `node_modules/` — Rebuilt inside the container via `npm ci`
- `.env` — Secrets injected via Cloudflare environment variables

---

## Step 3: Create `worker/index.ts`

Create directory `worker/` and file `worker/index.ts`:

```typescript
import { Container } from "@cloudflare/containers";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  ADMITRA_CONTAINER: DurableObjectNamespace<AdmitraContainer>;
  ASSETS: Fetcher;
  // Secrets (set via `wrangler secret put`)
  ANTHROPIC_API_KEY: string;
  FAL_KEY: string;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
}

// ─── Container Class ──────────────────────────────────────────────────────────

export class AdmitraContainer extends Container<Env> {
  // Port the Express server listens on
  defaultPort = 3003;

  // Keep container alive for 2 hours after last request
  // Disk is ephemeral — data lost on container stop
  sleepAfter = "2h";

  // Allow outbound internet (Anthropic API, fal.ai, Kling AI)
  enableInternet = true;

  // Health check endpoint for readiness probes
  pingEndpoint = "/health";

  // Static environment variables baked into the container
  envVars = {
    NODE_ENV: "production",
    PORT: "3003",
  };

  // Track initialization state
  private initialized = false;

  /**
   * Override fetch to handle one-time initialization.
   * Uses blockConcurrencyWhile to prevent race conditions.
   * Passes secrets from Cloudflare env to the container process.
   */
  async fetch(request: Request): Promise<Response> {
    // One-time startup with concurrency guard
    if (!this.initialized) {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (!this.initialized) {
          await this.startAndWaitForPorts({
            startOptions: {
              envVars: {
                // Pass secrets from Cloudflare to the container
                ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
                FAL_KEY: this.env.FAL_KEY,
                KLING_ACCESS_KEY: this.env.KLING_ACCESS_KEY,
                KLING_SECRET_KEY: this.env.KLING_SECRET_KEY,
              },
            },
          });
          this.initialized = true;
        }
      });
    }

    // Proxy request to Express server (supports HTTP + WebSocket)
    return super.fetch(request);
  }

  /**
   * Lifecycle: container started
   */
  onStart() {
    console.log("[AdmitraContainer] Container started");
  }

  /**
   * Lifecycle: container stopping (SIGTERM sent, 15 min until SIGKILL)
   */
  onStop() {
    console.log("[AdmitraContainer] Container stopping");
  }

  /**
   * Lifecycle: container error
   */
  onError(error: Error) {
    console.error("[AdmitraContainer] Container error:", error.message);
  }

  /**
   * Called when sleepAfter timeout reached.
   * Return true to stay alive, false to stop.
   */
  onActivityExpired(): boolean {
    // Allow container to sleep after timeout
    return false;
  }
}

// ─── Route Patterns ───────────────────────────────────────────────────────────

// Routes that should be proxied to the container
const CONTAINER_ROUTES = [
  "/health",
  "/upload",
  "/sessions",
  "/outputs",
  "/uploads",
  "/ws",
];

function isContainerRoute(pathname: string): boolean {
  return CONTAINER_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

// ─── Worker Entry Point ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── Route 1: /api/* prefix (frontend uses this in production) ──
    // Strip /api prefix and forward to container
    // e.g., /api/health → /health, /api/sessions/123 → /sessions/123
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const strippedPath = url.pathname.replace(/^\/api/, "") || "/";
      const containerUrl = new URL(strippedPath + url.search, url.origin);

      const containerRequest = new Request(containerUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      const container = env.ADMITRA_CONTAINER.getByName("singleton");
      return container.fetch(containerRequest);
    }

    // ── Route 2: Direct container routes (WS, static files, etc.) ──
    if (isContainerRoute(url.pathname)) {
      const container = env.ADMITRA_CONTAINER.getByName("singleton");
      return container.fetch(request);
    }

    // ── Route 3: Everything else → Static Assets (React SPA) ──
    return env.ASSETS.fetch(request);
  },
};
```

**How routing works:**
| Request | Action |
|---------|--------|
| `GET /` | Serve `index.html` (React SPA) |
| `GET /assets/main.js` | Serve static JS bundle |
| `GET /api/health` | Strip `/api` → forward `GET /health` to container |
| `POST /api/upload` | Strip `/api` → forward `POST /upload` to container |
| `WS /ws` | Forward WebSocket upgrade to container |
| `GET /uploads/image.png` | Forward to container (Express static files) |
| `GET /sessions/sess_123/outputs/ad.png` | Forward to container |

---

## Step 4: Create `worker/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"]
}
```

---

## Step 5: Create `wrangler.jsonc`

Create `wrangler.jsonc` in the project root:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "admitra-ai",
  "main": "worker/index.ts",
  "compatibility_date": "2026-01-10",
  "compatibility_flags": ["nodejs_compat"],

  // ── Static Assets (React Frontend) ──────────────────────────────────────
  "assets": {
    "directory": "frontend/dist",
    "binding": "ASSETS",
    // SPA mode: serve index.html for all non-file routes
    "not_found_handling": "single-page-application",
    // Always run Worker code first (Worker decides what goes to assets vs container)
    "run_worker_first": true
  },

  // ── Container Configuration ─────────────────────────────────────────────
  "containers": [
    {
      "class_name": "AdmitraContainer",
      "image": "./Dockerfile",
      // 4 GiB RAM, 0.5 vCPU, 8 GB disk
      // Needed for: Node.js + Express + Claude SDK + tsx + child processes
      "instance_type": "standard-1",
      "max_instances": 5
    }
  ],

  // ── Durable Object Bindings ─────────────────────────────────────────────
  "durable_objects": {
    "bindings": [
      {
        "name": "ADMITRA_CONTAINER",
        "class_name": "AdmitraContainer"
      }
    ]
  },

  // ── Migrations (required for Durable Objects with SQLite) ───────────────
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["AdmitraContainer"]
    }
  ],

  // ── Non-secret environment variables ────────────────────────────────────
  "vars": {
    "NODE_ENV": "production"
  }
}
```

**Instance types reference:**

| Type | vCPU | Memory | Disk | Use Case |
|------|------|--------|------|----------|
| `lite` | 1/16 | 256 MiB | 2 GB | Too small for this project |
| `basic` | 1/4 | 1 GiB | 4 GB | Might work, tight on memory |
| `standard-1` | 1/2 | 4 GiB | 8 GB | **Recommended starting point** |
| `standard-2` | 1 | 6 GiB | 12 GB | If standard-1 runs out of memory |

---

## Step 6: Modify Backend for Container Compatibility

### 6a. `server/sdk-server.ts`

**Change 1 — Configurable uploads directory (line 41):**

```typescript
// BEFORE:
const uploadsDir = path.join(__dirname, '../uploads');

// AFTER:
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
```

**Change 2 — Bind to all interfaces for container networking (line 616):**

```typescript
// BEFORE:
httpServer.listen(PORT, () => {

// AFTER:
httpServer.listen(Number(PORT), '0.0.0.0', () => {
```

### 6b. `server/lib/session-manager.ts`

**Change — Configurable session directory (line 59):**

```typescript
// BEFORE:
this.sessionDirectory = options.sessionDirectory || path.join(process.cwd(), 'sessions');

// AFTER:
this.sessionDirectory = options.sessionDirectory
  || process.env.SESSION_DIR
  || path.join(process.cwd(), 'sessions');
```

### 6c. `server/actions/index.ts`

**Change — Configurable logs directory (line 35):**

```typescript
// BEFORE:
this.logsDir = path.join(process.cwd(), '.logs', 'actions');

// AFTER:
this.logsDir = process.env.LOGS_DIR
  ? path.join(process.env.LOGS_DIR, 'actions')
  : path.join(process.cwd(), '.logs', 'actions');
```

---

## Step 7: Modify Frontend for Production

### 7a. `frontend/src/hooks/useWebSocket.ts`

**Change — Fix WebSocket URL when port is empty (lines 189-191):**

In production behind Cloudflare, `window.location.port` is empty (standard HTTPS port 443). The current code produces `wss://host:/ws` (note the dangling colon).

```typescript
// BEFORE:
const port = import.meta.env.DEV ? '3003' : window.location.port;
return `${protocol}//${host}:${port}/ws`;

// AFTER:
const port = import.meta.env.DEV ? '3003' : window.location.port;
const portSuffix = port ? `:${port}` : '';
return `${protocol}//${host}${portSuffix}/ws`;
```

---

## Step 8: Update `package.json`

Add deployment scripts:

```json
{
  "scripts": {
    "start": "tsx --env-file=.env server/sdk-server.ts",
    "dev": "tsx watch --env-file=.env server/sdk-server.ts",
    "build:frontend": "cd frontend && npm run build",
    "deploy": "npm run build:frontend && npx wrangler deploy",
    "deploy:secrets": "echo 'Run each: npx wrangler secret put ANTHROPIC_API_KEY / FAL_KEY / KLING_ACCESS_KEY / KLING_SECRET_KEY'"
  }
}
```

---

## Step 9: Update `.gitignore`

Add Wrangler build artifacts:

```
.wrangler/
```

---

## Step 10: Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens a browser for OAuth. One-time setup.

Verify authentication:

```bash
npx wrangler whoami
```

---

## Step 11: Set Secrets

Secrets are encrypted and stored in Cloudflare. They are NOT in `wrangler.jsonc`.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your API key when prompted

npx wrangler secret put FAL_KEY
npx wrangler secret put KLING_ACCESS_KEY
npx wrangler secret put KLING_SECRET_KEY
```

---

## Step 12: Build Frontend

```bash
cd frontend && npm install && npm run build
```

This creates `frontend/dist/` with the production React SPA bundle.

---

## Step 13: Deploy

```bash
npx wrangler deploy
```

This command:
1. Builds the Docker image from `Dockerfile`
2. Uploads the image to Cloudflare's container registry
3. Uploads `frontend/dist/` as static assets
4. Deploys the Worker code from `worker/index.ts`
5. Creates the Durable Object namespace and runs migrations

**First deploy takes 2-3 minutes** (Docker image build + global distribution).
Subsequent deploys are faster (layer caching).

---

## Step 14: Verify

```bash
# Health check
curl https://admitra-ai.<your-subdomain>.workers.dev/api/health

# Open in browser (React SPA)
open https://admitra-ai.<your-subdomain>.workers.dev
```

**Expected health response:**
```json
{
  "status": "healthy",
  "agent": "admitra-agent",
  "timestamp": "2026-02-15T...",
  "config": {
    "hasAnthropicKey": true,
    "hasFalKey": true,
    "port": 3003
  }
}
```

---

## How It Works End-to-End

### First Request (Cold Start)

1. Browser loads `https://admitra-ai.workers.dev` → Worker serves `index.html` from static assets
2. React app loads, `useWebSocket` hook connects to `wss://admitra-ai.workers.dev/ws`
3. Worker receives WebSocket upgrade → routes to `AdmitraContainer.getByName("singleton")`
4. Container not running → `blockConcurrencyWhile` triggers `startAndWaitForPorts()`
5. Docker container boots, `npx tsx server/sdk-server.ts` starts Express + WS server
6. `waitForPort(3003)` resolves when Express is listening
7. `super.fetch(request)` proxies the WebSocket upgrade to the container
8. WebSocket connection established, frontend receives `connected` message

**Cold start time: ~3-5 seconds** (container boot + Node.js startup)

### Subsequent Requests (Warm)

1. Browser sends chat message via WebSocket
2. Worker routes to existing container → already initialized → `super.fetch()` immediately
3. Express/WebSocket handler processes the message
4. Claude SDK streams response back through WebSocket

**Warm latency: <50ms** (Worker → Container overhead)

### After 2 Hours Idle

1. `sleepAfter: "2h"` triggers → container stops
2. **Disk is ephemeral** — session data, uploads, and outputs are lost
3. Next request triggers cold start again

---

## Production Improvements (Future)

### Persistent Storage with R2

Replace ephemeral disk storage with R2 for production:

```jsonc
// Add to wrangler.jsonc
"r2_buckets": [
  {
    "binding": "STORAGE_BUCKET",
    "bucket_name": "admitra-storage"
  }
]
```

Then modify `session-manager.ts` and upload handling to use R2 instead of filesystem.

### Multi-Tenant Isolation

Replace singleton with per-session containers:

```typescript
// Instead of:
const container = env.ADMITRA_CONTAINER.getByName("singleton");

// Use:
const sessionId = getSessionFromRequest(request);
const container = env.ADMITRA_CONTAINER.getByName(sessionId);
```

Each user/session gets their own isolated container with dedicated resources.

### Custom Domain

```bash
# Add custom domain in Cloudflare dashboard
# Or via wrangler:
npx wrangler domains add admitra.yourdomain.com
```

### Pre-warming with Cron

Prevent cold starts for key users:

```jsonc
// Add to wrangler.jsonc
"triggers": {
  "crons": ["*/30 * * * *"]
}
```

```typescript
// In worker/index.ts
export default {
  async fetch(request, env) { /* ... */ },

  async scheduled(event: ScheduledEvent, env: Env) {
    const container = env.ADMITRA_CONTAINER.getByName("singleton");
    await container.startAndWaitForPorts();
    // Ping health to keep warm
    await container.fetch(new Request("http://container/health"));
  },
};
```

---

## Local Development (Unchanged)

The Cloudflare deployment is additive. Local dev still works:

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

Vite dev proxy handles `/api` → `localhost:3003` routing as before.

---

## Troubleshooting

### "Container start timeout"

Container takes >20s to start. Solutions:
- Check `Dockerfile` for slow install steps
- Verify Express listens on port 3003
- Try `standard-2` instance for more CPU

### "WebSocket connection failed"

- Ensure using `container.fetch()` (NOT `containerFetch()`)
- Check that `/ws` route goes to container, not static assets
- Verify `useWebSocket.ts` port fix (empty port in production)

### "502 Bad Gateway" on API calls

- Container not ready yet (cold start). Wait and retry.
- Check `npx wrangler tail` for container logs
- Verify secrets are set: `npx wrangler secret list`

### "Out of memory"

- Upgrade instance type: change `instance_type` to `"standard-2"` (6 GiB) in `wrangler.jsonc`
- Or use custom: `"instance_type_custom": { "vcpu": 1, "memory_mib": 6144 }`

### View Logs

```bash
npx wrangler tail          # Live Worker + Container logs
npx wrangler containers list  # Check container status
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile` | CREATE | Container image definition |
| `worker/index.ts` | CREATE | Worker entry point + Container class |
| `worker/tsconfig.json` | CREATE | Worker TypeScript config |
| `wrangler.jsonc` | CREATE | Cloudflare deployment config |
| `server/sdk-server.ts` | MODIFY | Configurable dirs, bind 0.0.0.0 |
| `server/lib/session-manager.ts` | MODIFY | Configurable session directory |
| `server/actions/index.ts` | MODIFY | Configurable logs directory |
| `frontend/src/hooks/useWebSocket.ts` | MODIFY | Fix WS URL for production |
| `package.json` | MODIFY | Add deploy scripts |
| `.gitignore` | MODIFY | Add .wrangler/ |
