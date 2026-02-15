FROM node:20-slim

WORKDIR /app

# Install system dependencies required by Claude Agent SDK
# git: required by the CLI for repository operations
# procps: required for process management (ps command)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

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
