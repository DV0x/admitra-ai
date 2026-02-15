// server/actions/index.ts
// ActionsManager — auto-discovery, execution, JSONL audit logging
// Merges: fashion-shoot runScript() + email-agent auto-discovery + JSONL logging

import { spawn } from 'child_process';
import { readdir, appendFile, mkdir } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ActionTemplate,
  ActionTemplateModule,
  ActionHandler,
  ActionInstance,
  ActionResult,
  ActionContext,
  ActionLogEntry,
  ScriptResult,
  PipelineStage,
  PendingContinuation,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ActionsManager {
  private templates: Map<string, { config: ActionTemplate; handler: ActionHandler }> = new Map();
  private instances: Map<string, ActionInstance> = new Map();
  private pendingContinuations: Map<string, PendingContinuation> = new Map();
  private templatesDir: string;
  private logsDir: string;

  constructor() {
    this.templatesDir = path.join(__dirname, 'templates');
    this.logsDir = process.env.LOGS_DIR
      ? path.join(process.env.LOGS_DIR, 'actions')
      : path.join(process.cwd(), '.logs', 'actions');
    this.ensureLogsDir();
  }

  private ensureLogsDir(): void {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Template auto-discovery
  // ---------------------------------------------------------------------------

  async loadAllTemplates(): Promise<ActionTemplate[]> {
    this.templates.clear();

    if (!existsSync(this.templatesDir)) {
      console.log('  Actions templates directory does not exist, skipping');
      return [];
    }

    try {
      const files = await readdir(this.templatesDir);

      for (const file of files) {
        if (file.endsWith('.ts') && !file.startsWith('_')) {
          await this.loadTemplate(file);
        }
      }
    } catch (error) {
      console.error('  Error loading action templates:', error);
    }

    return this.getAllTemplates();
  }

  private async loadTemplate(filename: string): Promise<void> {
    try {
      const filePath = path.join(this.templatesDir, filename);
      const module = await import(`${filePath}?t=${Date.now()}`);

      if (module.config?.id && typeof module.handler === 'function') {
        this.templates.set(module.config.id, {
          config: module.config,
          handler: module.handler,
        });
        console.log(`  ✓ Loaded action template: ${module.config.id}`);
      } else {
        console.warn(`  ⚠ Invalid action template ${filename}: missing config.id or handler`);
      }
    } catch (error) {
      console.error(`  ✗ Error loading template ${filename}:`, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Template access
  // ---------------------------------------------------------------------------

  getTemplate(id: string): ActionTemplate | undefined {
    return this.templates.get(id)?.config;
  }

  getAllTemplates(): ActionTemplate[] {
    return Array.from(this.templates.values()).map((t) => t.config);
  }

  // ---------------------------------------------------------------------------
  // Instance management
  // ---------------------------------------------------------------------------

  registerInstance(instance: ActionInstance): void {
    this.instances.set(instance.instanceId, instance);
  }

  getInstance(instanceId: string): ActionInstance | undefined {
    return this.instances.get(instanceId);
  }

  updateInstanceStatus(instanceId: string, status: ActionInstance['status']): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = status;
    }
  }

  removeInstance(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  clearSessionInstances(sessionId: string): void {
    for (const [id, instance] of this.instances) {
      if (instance.sessionId === sessionId) {
        this.instances.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  async executeAction(
    instanceId: string,
    params: Record<string, unknown>,
    context: ActionContext
  ): Promise<ActionResult> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return {
        success: false,
        error: `Action instance not found: ${instanceId}`,
        errorCode: 'INSTANCE_NOT_FOUND',
        retryable: false,
      };
    }

    const entry = this.templates.get(instance.templateId);
    if (!entry) {
      return {
        success: false,
        error: `Action template not found: ${instance.templateId}`,
        errorCode: 'TEMPLATE_NOT_FOUND',
        retryable: false,
      };
    }

    instance.status = 'executing';
    const startTime = Date.now();
    let result: ActionResult;

    try {
      result = await entry.handler(params, context);
      result.duration = Date.now() - startTime;
      instance.status = result.success ? 'completed' : 'error';
    } catch (error) {
      instance.status = 'error';
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'EXECUTION_ERROR',
        retryable: true,
        duration: Date.now() - startTime,
      };
    }

    // Audit log
    await this.logExecution({
      timestamp: new Date().toISOString(),
      instanceId: instance.instanceId,
      templateId: instance.templateId,
      sessionId: instance.sessionId,
      params,
      result,
      duration: result.duration ?? Date.now() - startTime,
      error: result.error,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // JSONL audit logging
  // ---------------------------------------------------------------------------

  private async logExecution(entry: ActionLogEntry): Promise<void> {
    try {
      this.ensureLogsDir();
      const date = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logsDir, `${date}.jsonl`);
      await appendFile(logFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('Failed to log action execution:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Continuation management
  // ---------------------------------------------------------------------------

  setPendingContinuation(sessionId: string, continuation: PendingContinuation): void {
    this.pendingContinuations.set(sessionId, continuation);
  }

  getPendingContinuation(sessionId: string): PendingContinuation | undefined {
    return this.pendingContinuations.get(sessionId);
  }

  clearPendingContinuation(sessionId: string): void {
    this.pendingContinuations.delete(sessionId);
  }

  buildContinuationMessage(continuation: PendingContinuation): string {
    const { action, result, userParamChanges } = continuation;
    const template = this.getTemplate(action.templateId);

    const lines = [
      `[Action Completed: ${template?.name || action.templateId}]`,
      `Result: ${result.success ? 'SUCCESS' : 'FAILED'}`,
    ];

    if (result.artifact) {
      lines.push(`Artifact: ${result.artifact}`);
    }
    if (result.artifacts && result.artifacts.length > 0) {
      lines.push(`Artifacts: ${result.artifacts.join(', ')}`);
    }
    if (result.duration) {
      lines.push(`Duration: ${(result.duration / 1000).toFixed(1)}s`);
    }
    if (result.error) {
      lines.push(`Error: ${result.error}`);
    }

    if (userParamChanges && Object.keys(userParamChanges).length > 0) {
      lines.push('');
      lines.push('User Parameter Changes:');
      for (const [key, change] of Object.entries(userParamChanges)) {
        lines.push(`- ${key}: "${change.from}" → "${change.to}"`);
      }
    }

    lines.push('');
    lines.push('User wants to continue. Comment on result and suggest next step.');

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// runScript — spawns `npx tsx <script>` as child process (from fashion-shoot)
// ---------------------------------------------------------------------------

export function runScript(scriptPath: string, args: string[], cwd: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const fullPath = scriptPath.includes('/')
      ? path.join(cwd, scriptPath)
      : path.join(cwd, 'scripts', `${scriptPath}.ts`);

    console.log(`🔧 [SCRIPT] Running: npx tsx ${fullPath}`);
    console.log(`   CWD: ${cwd}`);
    console.log(`   Args: ${args.join(' ')}`);

    const proc = spawn('npx', ['tsx', fullPath, ...args], {
      cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const artifacts: string[] = [];

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      const lines = text.split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.type === 'artifact' && parsed.path) {
            artifacts.push(parsed.path);
          } else if (parsed.type === 'artifacts' && parsed.paths) {
            artifacts.push(...parsed.paths);
          }
        } catch {
          // Not JSON, ignore
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      console.log(`🔧 [SCRIPT] Completed with exit code: ${exitCode}`);
      console.log(`   Artifacts found: ${artifacts.length > 0 ? artifacts.join(', ') : '(none)'}`);
      if (stderr) {
        console.log(`   Stderr: ${stderr.substring(0, 500)}`);
      }
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      });
    });

    proc.on('error', (error) => {
      resolve({
        stdout,
        stderr: stderr + '\n' + error.message,
        exitCode: 1,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// createActionContext — factory for handler context
// ---------------------------------------------------------------------------

export function createActionContext(options: {
  sessionId: string;
  cwd: string;
  outputDir: string;
  referenceImages: string[];
  assetGetter: (type: 'ads' | 'videoAds') => string[] | null;
  stageGetter: () => PipelineStage;
  progressEmitter: (stage: string, message: string, progress?: number) => void;
}): ActionContext {
  const { sessionId, cwd, outputDir, referenceImages, assetGetter, stageGetter, progressEmitter } = options;

  return {
    sessionId,
    cwd,
    outputDir,
    referenceImages,
    getAsset: assetGetter,
    getStage: stageGetter,
    emitProgress: progressEmitter,

    async runScript(scriptPath: string, args: string[]): Promise<ScriptResult> {
      return runScript(scriptPath, args, cwd);
    },

    log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
      const prefix = level === 'error' ? '✗' : level === 'warn' ? '⚠' : 'ℹ';
      console.log(`${prefix} [ACTION:${sessionId.substring(0, 8)}] ${message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton + initialization
// ---------------------------------------------------------------------------

export const actionsManager = new ActionsManager();

export async function initializeActions(): Promise<void> {
  console.log('📋 Loading action templates...');
  const templates = await actionsManager.loadAllTemplates();
  console.log(`📋 Actions system initialized: ${templates.length} template(s) loaded`);
}

// Re-export types
export type { ActionResult, ActionInstance, PendingContinuation } from './types.js';
