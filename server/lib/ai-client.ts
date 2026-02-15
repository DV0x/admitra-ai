import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { EventEmitter } from 'events';
import { SessionManager } from './session-manager.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator-prompt.js';

// Broadcast function type — injected from sdk-server.ts to avoid circular dependency
export type BroadcastFn = (sessionId: string, message: Record<string, unknown>) => void;

// Action proposal event (from action-proposer skill)
export interface ActionProposal {
  type: 'action_proposal';
  instanceId: string;
  templateId: string;
  label: string;
  params: Record<string, unknown>;
  timestamp: string;
}

// Event emitter for action proposals
// Server listens to this and forwards to frontend via WebSocket
export const actionEmitter = new EventEmitter();

/**
 * Parse action proposal from script output
 */
function parseActionProposal(output: string): ActionProposal | null {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'action_proposal' && parsed.instanceId && parsed.templateId) {
        return parsed as ActionProposal;
      }
    } catch {
      // Not valid JSON, skip
    }
  }
  return null;
}

/**
 * Create hooks for the action-based workflow using SDK hook system
 * - PreToolUse: Block direct script execution (uses SDK matcher for Bash)
 * - PostToolUse: Intercept action proposals + WS notification
 * - Notification: Forward agent status to WebSocket
 */
function createActionHooks(sessionId: string, broadcast?: BroadcastFn) {
  // PreToolUse: Block generate-image/generate-video direct execution
  const blockDirectScripts: HookCallback = async (input, _toolUseID, _ctx) => {
    const command = ((input as any).tool_input?.command as string) || '';

    if (/generate-image|generate-video/.test(command)) {
      console.log(`🚫 [BLOCKED] Direct script execution: ${command.substring(0, 100)}...`);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason:
            'Direct script execution is not allowed. Use the action-proposer skill instead to propose generate_ad or generate_video_ad actions for user approval.',
        },
      };
    }

    return {};
  };

  // PostToolUse: Detect action proposals from Bash output + WS notification
  const detectActionProposals: HookCallback = async (input, _toolUseID, _ctx) => {
    const postInput = input as any;

    // WS notification for all tool completions
    if (broadcast) {
      broadcast(sessionId, {
        type: 'tool_complete',
        tool: postInput.tool_name,
        result_preview: JSON.stringify(postInput.tool_response).substring(0, 500),
      });
    }

    // Only parse action proposals from Bash output
    if (postInput.tool_name !== 'Bash') {
      return {};
    }

    let output: string;
    if (typeof postInput.tool_response === 'string') {
      output = postInput.tool_response;
    } else if (postInput.tool_response && typeof postInput.tool_response === 'object' && 'stdout' in postInput.tool_response) {
      output = (postInput.tool_response as any).stdout;
    } else {
      output = JSON.stringify(postInput.tool_response);
    }

    const proposal = parseActionProposal(output);
    if (proposal) {
      console.log(`📋 [ACTION PROPOSAL] ${proposal.templateId}: ${proposal.label}`);
      console.log(`   Instance: ${proposal.instanceId}`);
      actionEmitter.emit('proposal', { sessionId, proposal });
    }

    return {};
  };

  // Notification: Forward agent status messages to WebSocket
  const forwardNotifications: HookCallback = async (input, _toolUseID, _ctx) => {
    const notification = input as any;

    if (broadcast) {
      broadcast(sessionId, {
        type: 'notification',
        title: notification.title,
        message: notification.message,
      });
    }

    return {};
  };

  return {
    PreToolUse: [
      { matcher: 'Bash', hooks: [blockDirectScripts] },
    ],
    PostToolUse: [
      { hooks: [detectActionProposals] },  // No matcher — fires for all tools (WS notification)
    ],
    Notification: [
      { hooks: [forwardNotifications] },  // Matcher ignored for Notification hooks
    ],
  };
}


// Image content block for multimodal input
interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

interface TextContentBlock {
  type: 'text';
  text: string;
}

type ContentBlock = TextContentBlock | ImageContentBlock;

/**
 * Load an image file and convert to base64
 */
function loadImageAsBase64(imagePath: string): ImageContentBlock | null {
  if (!existsSync(imagePath)) {
    console.error(`⚠️ Image not found: ${imagePath}`);
    return null;
  }

  const ext = imagePath.toLowerCase().split('.').pop();
  const mediaTypeMap: Record<string, ImageContentBlock['source']['media_type']> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };

  const mediaType = mediaTypeMap[ext || ''] || 'image/jpeg';

  try {
    const data = readFileSync(imagePath, 'base64');
    console.log(`📷 Loaded image: ${imagePath} (${mediaType})`);
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data
      }
    };
  } catch (error) {
    console.error(`⚠️ Failed to load image: ${imagePath}`, error);
    return null;
  }
}

/**
 * AIClient - Wrapper for Claude SDK
 * Handles SDK configuration, streaming, and session management
 */
export class AIClient {
  private defaultOptions: Partial<Options>;
  private sessionManager: SessionManager;
  private activeGenerations: Map<string, AbortController> = new Map();
  private broadcastFn?: BroadcastFn;

  constructor(sessionManager?: SessionManager) {
    // Ensure cwd points to agent directory where .claude/ is located
    const projectRoot = process.cwd().endsWith('/server')
      ? resolve(process.cwd(), '..', 'agent')
      : resolve(process.cwd(), 'agent');

    this.defaultOptions = {
      cwd: projectRoot,
      model: 'claude-opus-4-5-20251101',
      maxTurns: 100,
      settingSources: ['project'],  // Use project settings only (not user settings)
      permissionMode: 'default',
      canUseTool: async (_toolName: string, input: Record<string, unknown>) => ({
        behavior: 'allow' as const,
        updatedInput: input
      }),
      allowedTools: [
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "Task",
        "Skill",
        "TodoWrite",
        "WebFetch"
      ],
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT
    };

    this.sessionManager = sessionManager || new SessionManager();
    console.log(`🎬 AI Client initialized with cwd: ${projectRoot}`);
  }

  /**
   * Set broadcast function for WebSocket notifications from hooks
   * Called from sdk-server.ts after wsHandler is created
   */
  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn;
  }

  /**
   * Create async generator for SDK prompt
   * Critical: Generator must stay alive during tool execution
   * Supports multimodal input (text + images)
   */
  private async *createPromptGenerator(prompt: string, imagePaths?: string[], signal?: AbortSignal) {
    // Build content array for multimodal input
    let content: string | ContentBlock[];

    if (imagePaths && imagePaths.length > 0) {
      const contentBlocks: ContentBlock[] = [
        { type: 'text', text: prompt }
      ];

      // Load and add images
      for (const imagePath of imagePaths) {
        const imageBlock = loadImageAsBase64(imagePath);
        if (imageBlock) {
          contentBlocks.push(imageBlock);
        }
      }

      content = contentBlocks;
      console.log(`📨 Sending prompt with ${imagePaths.length} image(s)`);
    } else {
      content = prompt;
    }

    yield {
      type: "user" as const,
      message: { role: "user" as const, content },
      parent_tool_use_id: null
    } as any;

    // Keep generator alive during tool execution
    if (signal) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve());
      });
    } else {
      await new Promise<void>(() => {});
    }
  }

  /**
   * Session-aware query with automatic session management
   * Supports multimodal input (text + images)
   * @param prompt - The user prompt
   * @param sessionId - Optional session ID
   * @param metadata - Optional metadata including systemPrompt
   * @param imagePaths - Optional image paths for multimodal input
   */
  async *queryWithSession(
    prompt: string,
    sessionId?: string,
    metadata?: { systemPrompt?: string },
    imagePaths?: string[]
  ) {
    const session = await this.sessionManager.getOrCreateSession(sessionId);
    const resumeOptions = this.sessionManager.getResumeOptions(session.id);
    const abortController = new AbortController();

    // Store AbortController for potential cancellation
    this.activeGenerations.set(session.id, abortController);

    // Use custom or default system prompt
    const systemPrompt = metadata?.systemPrompt || this.defaultOptions.systemPrompt;

    const queryOptions = {
      ...this.defaultOptions,
      ...resumeOptions,
      systemPrompt,
      includePartialMessages: true,  // Enable real-time token streaming
      abortController,
      hooks: createActionHooks(session.id, this.broadcastFn)
    };

    console.log(`🔄 Query with session ${session.id}`, {
      hasResume: !!resumeOptions.resume,
      turnCount: session.turnCount,
      imageCount: imagePaths?.length || 0
    });

    try {
      const promptGenerator = this.createPromptGenerator(prompt, imagePaths, abortController.signal);

      for await (const message of query({ prompt: promptGenerator, options: queryOptions })) {
        // Capture SDK session ID from init message
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          await this.sessionManager.updateSdkSessionId(session.id, message.session_id);
        }

        await this.sessionManager.addMessage(session.id, message);
        yield { message, sessionId: session.id };

        // Abort the generator after receiving the result message
        // This allows the for-await loop to complete
        if (message.type === 'result') {
          this.activeGenerations.delete(session.id);
          abortController.abort();
          break;
        }
      }
    } catch (error) {
      this.activeGenerations.delete(session.id);
      abortController.abort();
      throw error;
    } finally {
      // Ensure cleanup even if iterator is broken
      this.activeGenerations.delete(session.id);
    }
  }

  /**
   * Cancel an active generation for a session
   * @param sessionId - The session ID to cancel
   * @returns true if generation was cancelled, false if no active generation
   */
  cancelGeneration(sessionId: string): boolean {
    const abortController = this.activeGenerations.get(sessionId);
    if (abortController) {
      console.log(`🛑 Cancelling generation for session: ${sessionId}`);
      abortController.abort();
      this.activeGenerations.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Check if a session has an active generation
   * @param sessionId - The session ID to check
   * @returns true if generation is active
   */
  isGenerating(sessionId: string): boolean {
    return this.activeGenerations.has(sessionId);
  }

  /**
   * Get all active generation session IDs
   */
  getActiveGenerations(): string[] {
    return Array.from(this.activeGenerations.keys());
  }

  /**
   * Get session manager
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Add MCP server to the client
   */
  addMcpServer(name: string, server: any) {
    if (!this.defaultOptions.mcpServers) {
      this.defaultOptions.mcpServers = {};
    }
    this.defaultOptions.mcpServers[name] = server;

    // Also add to allowed tools
    if (!this.defaultOptions.allowedTools) {
      this.defaultOptions.allowedTools = [];
    }

    console.log(`✅ Added MCP server: ${name}`);
  }
}

// Export singleton instances
export const sessionManager = new SessionManager();
export const aiClient = new AIClient(sessionManager);
