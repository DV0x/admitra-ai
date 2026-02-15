// server/actions/types.ts
// Action System Types for AdMitra
// Pattern: email-agent one-file templates + fashion-shoot execution model

export type PipelineStage = 'ad' | 'video';

export type ParamType = 'enum' | 'text' | 'boolean' | 'number';

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamSchema {
  type: ParamType;
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: ParamOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  multiline?: boolean;
  locked?: boolean;
  advanced?: boolean;
}

// Template definition — the `config` export in each template file
export interface ActionTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  stage: PipelineStage;
  parameters: Record<string, ParamSchema>;
  script: string;
  outputPattern: string;
}

// Template handler function signature
export type ActionHandler = (
  params: Record<string, unknown>,
  context: ActionContext
) => Promise<ActionResult>;

// A loaded template module (config + handler in one file)
export interface ActionTemplateModule {
  config: ActionTemplate;
  handler: ActionHandler;
}

// Instance — a specific proposal with filled-in params
export interface ActionInstance {
  instanceId: string;
  sessionId: string;
  templateId: string;
  label: string;
  params: Record<string, unknown>;
  timestamp: Date;
  status: 'pending' | 'executing' | 'completed' | 'error';
}

// Result of running a child script
export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts?: string[];
}

// Context passed to handler during execution
export interface ActionContext {
  sessionId: string;
  cwd: string;
  outputDir: string;
  referenceImages: string[];
  getAsset: (type: 'ads' | 'videoAds') => string[] | null;
  getStage: () => PipelineStage;
  emitProgress: (stage: string, message: string, progress?: number) => void;
  runScript: (scriptPath: string, args: string[]) => Promise<ScriptResult>;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

// Result returned by handler
export interface ActionResult {
  success: boolean;
  artifact?: string;
  artifacts?: string[];
  error?: string;
  errorCode?: string;
  message?: string;
  duration?: number;
  retryable?: boolean;
}

// Pending continuation (waiting for user to click Continue)
export interface PendingContinuation {
  sessionId: string;
  action: ActionInstance;
  result: ActionResult;
  userParamChanges?: Record<string, { from: unknown; to: unknown }>;
  timestamp: Date;
}

// Audit log entry (written to JSONL)
export interface ActionLogEntry {
  timestamp: string;
  instanceId: string;
  templateId: string;
  sessionId: string;
  params: Record<string, unknown>;
  result: ActionResult;
  duration: number;
  error?: string;
}

// WebSocket message types — Client to Server

export interface ExecuteActionMessage {
  type: 'execute_action';
  sessionId: string;
  instanceId: string;
  params: Record<string, unknown>;
  originalParams: Record<string, unknown>;
}

export interface CancelActionMessage {
  type: 'cancel_action';
  sessionId: string;
  instanceId: string;
}

export interface ContinueMessage {
  type: 'continue';
  sessionId: string;
  content?: string;
}

// WebSocket message types — Server to Client

export interface ActionInstanceMessage {
  type: 'action_instance';
  sessionId: string;
  instance: ActionInstance;
  template: ActionTemplate;
}

export interface ActionStartMessage {
  type: 'action_start';
  sessionId: string;
  instanceId: string;
  templateId: string;
  label: string;
}

export interface ActionProgressMessage {
  type: 'action_progress';
  sessionId: string;
  instanceId: string;
  stage: string;
  message: string;
  progress?: number;
  retryAttempt?: number;
}

export interface ActionCompleteMessage {
  type: 'action_complete';
  sessionId: string;
  instanceId: string;
  result: {
    success: true;
    artifact?: string;
    artifacts?: string[];
    message?: string;
    duration?: number;
  };
}

export interface ActionErrorMessage {
  type: 'action_error';
  sessionId: string;
  instanceId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    autoRetried: boolean;
  };
}

export interface AwaitingContinuationMessage {
  type: 'awaiting_continuation';
  sessionId: string;
  instanceId: string;
}
