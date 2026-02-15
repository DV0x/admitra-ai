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
