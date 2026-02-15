import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import multer from 'multer';
import { aiClient, sessionManager, actionEmitter, type ActionProposal } from './lib/ai-client.js';
import { SDKInstrumentor } from './lib/instrumentor.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './lib/orchestrator-prompt.js';
import { WebSocketHandler, type WSServerMessage } from './lib/websocket-handler.js';
import { handleSDKStreaming } from './lib/streaming.js';
import { actionsManager, createActionContext, initializeActions, type ActionInstance, type ActionResult, type PendingContinuation } from './actions/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3003;

// Create HTTP server for both Express and WebSocket
const httpServer = createServer(app);

// Initialize WebSocket handler
const wsHandler = new WebSocketHandler(httpServer);

// Wire up WebSocket broadcast into AI client hooks (Notification, PostToolUse)
aiClient.setBroadcast((sessionId, message) =>
  wsHandler.broadcastToSession(sessionId, message as unknown as WSServerMessage)
);

app.use(cors());
app.use(express.json());

// Serve generated assets from agent/outputs
app.use('/outputs', express.static(path.join(__dirname, '../agent/outputs')));

// Serve uploaded files
const uploadsDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  }
});

// Listen for action proposals from PostToolUse hooks
// Register instance and forward to WebSocket clients for ActionCard UI
actionEmitter.on('proposal', ({ sessionId, proposal }: { sessionId: string; proposal: ActionProposal }) => {
  console.log(`📋 [ACTION PROPOSAL] Forwarding to frontend:`);
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Template: ${proposal.templateId}`);
  console.log(`   Label: ${proposal.label}`);
  console.log(`   Instance: ${proposal.instanceId}`);

  // Register the action instance in ActionsManager
  const instance: ActionInstance = {
    instanceId: proposal.instanceId,
    sessionId,
    templateId: proposal.templateId,
    label: proposal.label,
    params: proposal.params,
    timestamp: new Date(proposal.timestamp),
    status: 'pending',
  };
  actionsManager.registerInstance(instance);

  // Get the template for frontend rendering
  const template = actionsManager.getTemplate(proposal.templateId);

  // Broadcast action_instance message to WebSocket subscribers
  const actionMessage = {
    type: 'action_instance' as const,
    sessionId,
    instanceId: proposal.instanceId,
    templateId: proposal.templateId,
    label: proposal.label,
    params: proposal.params,
    timestamp: proposal.timestamp,
    template,  // Include template for frontend form rendering
  };

  console.log(`📋 [ACTION PROPOSAL] WS subscribers: ${wsHandler.getSessionSubscriberCount(sessionId)}`);

  wsHandler.broadcastToSession(sessionId, actionMessage as WSServerMessage);
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    agent: 'admitra-agent',
    timestamp: new Date().toISOString(),
    config: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasFalKey: !!process.env.FAL_KEY,
      port: PORT
    }
  });
});

// Upload multiple images (reference images)
app.post('/upload', upload.array('images', 10), (req, res) => {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  const uploadedFiles = files.map(file => ({
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype,
    url: `/uploads/${file.filename}`
  }));

  console.log(`📤 Uploaded ${files.length} file(s):`, uploadedFiles.map(f => f.originalName).join(', '));

  res.json({
    success: true,
    count: uploadedFiles.length,
    files: uploadedFiles
  });
});

// List sessions
app.get('/sessions', (_req, res) => {
  const sessions = sessionManager.getActiveSessions();
  res.json({
    success: true,
    count: sessions.length,
    sessions: sessions.map(s => ({
      id: s.id,
      sdkSessionId: s.sdkSessionId,
      createdAt: s.createdAt,
      lastAccessedAt: s.lastAccessedAt,
      metadata: s.metadata,
      turnCount: s.turnCount
    }))
  });
});

// Get session info
app.get('/sessions/:id', (req, res) => {
  const stats = sessionManager.getSessionStats(req.params.id);
  if (!stats) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, session: stats });
});

// Get pipeline status for a session
app.get('/sessions/:id/pipeline', (req, res) => {
  const pipelineStatus = sessionManager.getPipelineStatus(req.params.id);
  if (!pipelineStatus) {
    return res.status(404).json({ success: false, error: 'Session or pipeline not found' });
  }
  res.json({
    success: true,
    sessionId: req.params.id,
    pipeline: pipelineStatus
  });
});

// Get assets for a session
app.get('/sessions/:id/assets', (req, res) => {
  const assets = sessionManager.getSessionAssets(req.params.id);
  if (!assets) {
    return res.status(404).json({ success: false, error: 'Session or assets not found' });
  }
  res.json({
    success: true,
    sessionId: req.params.id,
    outputDir: sessionManager.getSessionOutputDir(req.params.id),
    assets
  });
});

// Cancel active generation for a session
app.post('/sessions/:id/cancel', (req, res) => {
  const sessionId = req.params.id;
  console.log(`🛑 Cancel request for session: ${sessionId}`);

  const cancelled = aiClient.cancelGeneration(sessionId);

  if (cancelled) {
    // Broadcast to WebSocket subscribers
    wsHandler.broadcastToSession(sessionId, { type: 'cancelled', sessionId });

    res.json({ success: true, message: 'Generation cancelled' });
  } else {
    res.status(404).json({ success: false, error: 'No active generation for this session' });
  }
});

// ============================================
// WebSocket Event Handlers
// ============================================

/**
 * Handle WebSocket 'chat' event - Start new generation via WebSocket
 */
wsHandler.on('chat', async ({ clientId, sessionId, content, images }) => {
  console.log(`🔌 [WS] Chat from ${clientId}: ${content.substring(0, 50)}...`);

  const campaignSessionId = sessionId || `session_${Date.now()}`;
  const instrumentor = new SDKInstrumentor(campaignSessionId, content);

  // Auto-subscribe client to session
  wsHandler.autoSubscribeClient(clientId, campaignSessionId);

  // Send session init
  wsHandler.broadcastToSession(campaignSessionId, {
    type: 'session_init',
    sessionId: campaignSessionId
  });

  try {
    await sessionManager.getOrCreateSession(campaignSessionId);
    await sessionManager.createSessionDirectories(campaignSessionId);

    if (images && images.length > 0) {
      await sessionManager.addInputImages(campaignSessionId, images);
    }

    // Build prompt with image paths
    let fullPrompt = content;
    if (images && images.length > 0) {
      const inputFlags = images.map((img: string) => `--input "${img}"`).join(' ');
      fullPrompt = `${content}

## Reference Image File Paths (use ALL of these with --input flags in generate-image.ts)
${images.map((img: string, i: number) => `- Reference ${i + 1}: ${img}`).join('\n')}

CRITICAL: You MUST pass ALL reference images using multiple --input flags to preserve subject appearance AND include all referenced items.

Example command with ALL ${images.length} reference images:
npx tsx scripts/generate-image.ts --prompt "..." ${inputFlags} --output outputs/ads/ad.png --aspect-ratio 1:1 --resolution 2K`;
    }

    await handleSDKStreaming(
      aiClient,
      fullPrompt,
      campaignSessionId,
      wsHandler,
      instrumentor,
      sessionManager,
      {
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        imagePaths: images,
      }
    );
  } catch (error: any) {
    if (error.name === 'AbortError') {
      wsHandler.broadcastToSession(campaignSessionId, { type: 'cancelled', sessionId: campaignSessionId });
    } else {
      console.error('❌ [WS] Chat error:', error.message);
      wsHandler.broadcastToSession(campaignSessionId, { type: 'error', error: error.message });
    }
  }
});

/**
 * Handle WebSocket 'continue' event - Continue session via WebSocket
 */
wsHandler.on('continue', async ({ clientId, sessionId, content }) => {
  let prompt = content || 'continue';
  console.log(`🔌 [WS] Continue from ${clientId} for session ${sessionId}: ${prompt.substring(0, 50)}...`);

  // Check for pending action continuation
  const pendingContinuation = actionsManager.getPendingContinuation(sessionId);
  if (pendingContinuation) {
    // Build continuation message with action result context
    const actionContext = actionsManager.buildContinuationMessage(pendingContinuation);

    // If user provided additional content, append it
    if (content && content !== 'continue') {
      prompt = `${actionContext}\n\nUser message: ${content}`;
    } else {
      prompt = actionContext;
    }

    // Clear pending continuation
    actionsManager.clearPendingContinuation(sessionId);
    console.log(`📋 [CONTINUE] Injecting action result context for ${pendingContinuation.action.templateId}`);
  }

  const instrumentor = new SDKInstrumentor(sessionId, prompt);

  try {
    await handleSDKStreaming(
      aiClient,
      prompt,
      sessionId,
      wsHandler,
      instrumentor,
      sessionManager,
      { systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT }
    );
  } catch (error: any) {
    if (error.name === 'AbortError') {
      wsHandler.broadcastToSession(sessionId, { type: 'cancelled', sessionId });
    } else {
      console.error('❌ [WS] Continue error:', error.message);
      wsHandler.broadcastToSession(sessionId, { type: 'error', error: error.message });
    }
  }
});

/**
 * Handle WebSocket 'question_answer' event - Forward user answers to pending AskUserQuestion
 */
wsHandler.on('question_answer', async ({ clientId, sessionId, questionId, answers }) => {
  console.log(`❓ [WS] Question answer from ${clientId}: questionId=${questionId}`);

  const resolved = aiClient.resolveQuestion(questionId, answers);
  if (!resolved) {
    console.warn(`⚠️ No pending question found for questionId: ${questionId}`);
    wsHandler.sendToClientById(clientId, {
      type: 'error',
      error: `No pending question found for questionId: ${questionId}`,
    });
  }
});

/**
 * Handle WebSocket 'cancel' event - Cancel active generation
 */
wsHandler.on('cancel', async ({ clientId, sessionId }) => {
  console.log(`🔌 [WS] Cancel from ${clientId} for session ${sessionId}`);

  const cancelled = aiClient.cancelGeneration(sessionId);
  if (cancelled) {
    wsHandler.broadcastToSession(sessionId, { type: 'cancelled', sessionId });
  } else {
    wsHandler.sendToClientById(clientId, { type: 'error', error: 'No active generation to cancel' });
  }
});

/**
 * Handle WebSocket 'execute_action' event - Execute a proposed action
 */
wsHandler.on('execute_action', async ({ clientId, sessionId, instanceId, params, originalParams }) => {
  console.log(`🎬 [WS] Execute action from ${clientId}: instance=${instanceId}`);

  // 1. Look up instance
  const instance = actionsManager.getInstance(instanceId);
  if (!instance) {
    wsHandler.sendToClientById(clientId, {
      type: 'error',
      error: `Action instance not found: ${instanceId}`,
    });
    return;
  }

  const template = actionsManager.getTemplate(instance.templateId);
  if (!template) {
    wsHandler.sendToClientById(clientId, {
      type: 'error',
      error: `Action template not found: ${instance.templateId}`,
    });
    return;
  }

  // 2. Broadcast action_start
  wsHandler.broadcastToSession(sessionId, {
    type: 'action_start',
    sessionId,
    instanceId,
    templateId: instance.templateId,
    label: instance.label,
  } as WSServerMessage);

  // 3. Create action context
  const outputDir = sessionManager.getSessionOutputDir(sessionId) || `agent/outputs`;
  const pipelineStatus = sessionManager.getPipelineStatus(sessionId);
  const referenceImages = pipelineStatus?.inputImages || [];

  console.log(`📋 [ACTION] Context for ${instanceId}:`);
  console.log(`   Output dir: ${outputDir}`);
  console.log(`   Reference images: ${referenceImages.length > 0 ? referenceImages.join(', ') : '(none)'}`);
  console.log(`   Params:`, JSON.stringify(params, null, 2));

  const context = createActionContext({
    sessionId,
    cwd: process.cwd() + '/agent',
    outputDir,
    referenceImages,
    assetGetter: (type) => {
      const assets = sessionManager.getSessionAssets(sessionId);
      if (!assets) return null;
      switch (type) {
        case 'ads': return assets.ads ?? null;
        case 'videoAds': return assets.videoAds ?? null;
        default: return null;
      }
    },
    stageGetter: () => {
      const pipeline = sessionManager.getPipelineStatus(sessionId);
      // Map session-manager stage to action stage
      const stageMap: Record<string, 'ad' | 'video'> = {
        'initialized': 'ad',
        'generating': 'ad',
        'completed': 'video',
        'error': 'ad',
      };
      return stageMap[pipeline?.stage || 'initialized'] || 'ad';
    },
    progressEmitter: (stage, message, progress) => {
      wsHandler.broadcastToSession(sessionId, {
        type: 'action_progress',
        sessionId,
        instanceId,
        stage,
        message,
        progress,
      } as WSServerMessage);
    },
  });

  // 4. Execute with auto-retry once on transient errors
  let result: ActionResult;

  result = await actionsManager.executeAction(instanceId, params, context);

  // Auto-retry once if the error is retryable
  if (!result.success && result.retryable) {
    console.log(`🔄 [ACTION] Auto-retrying action ${instanceId}...`);

    wsHandler.broadcastToSession(sessionId, {
      type: 'action_progress',
      sessionId,
      instanceId,
      stage: 'retry',
      message: 'Retrying after transient error...',
      retryAttempt: 1,
    } as WSServerMessage);

    // Wait a bit before retry
    await new Promise(resolve => setTimeout(resolve, 2000));

    result = await actionsManager.executeAction(instanceId, params, context);
  }

  // 5. Store artifacts in session manager for subsequent actions
  if (result.success) {
    const assetTypeMap: Record<string, 'ad' | 'videoAd'> = {
      'generate_ad': 'ad',
      'generate_video_ad': 'videoAd',
    };

    const assetType = assetTypeMap[instance.templateId];
    if (assetType) {
      if (result.artifact) {
        await sessionManager.addAsset(sessionId, assetType, result.artifact);
        console.log(`💾 [ACTION] Stored ${assetType} asset: ${result.artifact}`);
      } else if (result.artifacts && result.artifacts.length > 0) {
        for (const artifact of result.artifacts) {
          await sessionManager.addAsset(sessionId, assetType, artifact);
        }
        console.log(`💾 [ACTION] Stored ${result.artifacts.length} ${assetType} assets`);
      }
    }
  }

  // 6. Broadcast action_complete or action_error
  console.log(`📋 [ACTION] Result for ${instanceId}:`);
  console.log(`   Success: ${result.success}`);
  console.log(`   Artifact: ${result.artifact || '(none)'}`);
  console.log(`   Artifacts: ${result.artifacts?.join(', ') || '(none)'}`);
  console.log(`   Error: ${result.error || '(none)'}`);
  console.log(`   Duration: ${result.duration}ms`);

  if (result.success) {
    wsHandler.broadcastToSession(sessionId, {
      type: 'action_complete',
      sessionId,
      instanceId,
      result: {
        success: true,
        artifact: result.artifact,
        artifacts: result.artifacts,
        message: result.message,
        duration: result.duration,
      },
    } as WSServerMessage);
  } else {
    wsHandler.broadcastToSession(sessionId, {
      type: 'action_complete',
      sessionId,
      instanceId,
      result: {
        success: false,
        error: result.error,
        message: result.message,
        duration: result.duration,
      },
    } as WSServerMessage);
  }

  // 7. Calculate user parameter changes
  const userParamChanges: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(params)) {
    if (JSON.stringify(params[key]) !== JSON.stringify(originalParams[key])) {
      userParamChanges[key] = {
        from: originalParams[key],
        to: params[key],
      };
    }
  }

  // 8. Store pending continuation (DO NOT auto-continue)
  const pendingContinuation: PendingContinuation = {
    sessionId,
    action: instance,
    result,
    userParamChanges: Object.keys(userParamChanges).length > 0 ? userParamChanges : undefined,
    timestamp: new Date(),
  };
  actionsManager.setPendingContinuation(sessionId, pendingContinuation);

  // 9. Broadcast awaiting_continuation
  wsHandler.broadcastToSession(sessionId, {
    type: 'awaiting_continuation',
    sessionId,
    instanceId,
  } as WSServerMessage);

  console.log(`✅ [ACTION] Action ${instanceId} completed. Awaiting user continuation.`);
});

/**
 * Handle WebSocket 'continue_action' event - Continue after action completion
 */
wsHandler.on('continue_action', async ({ clientId, sessionId, instanceId }) => {
  console.log(`▶️ [WS] Continue action from ${clientId}: instance=${instanceId}`);

  // Check for pending continuation
  const pendingContinuation = actionsManager.getPendingContinuation(sessionId);
  if (!pendingContinuation) {
    wsHandler.sendToClientById(clientId, {
      type: 'error',
      error: 'No pending continuation for this session',
    });
    return;
  }

  // Build continuation message
  const continuationMessage = actionsManager.buildContinuationMessage(pendingContinuation);

  // Clear pending continuation
  actionsManager.clearPendingContinuation(sessionId);

  // Continue the agent session with the result context
  const instrumentor = new SDKInstrumentor(sessionId, continuationMessage);

  try {
    await handleSDKStreaming(
      aiClient,
      continuationMessage,
      sessionId,
      wsHandler,
      instrumentor,
      sessionManager,
      { systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT }
    );
  } catch (error: any) {
    if (error.name === 'AbortError') {
      wsHandler.broadcastToSession(sessionId, { type: 'cancelled', sessionId });
    } else {
      console.error('❌ [WS] Continue action error:', error.message);
      wsHandler.broadcastToSession(sessionId, { type: 'error', error: error.message });
    }
  }
});

// ============================================
// Server Startup
// ============================================

// Load action templates (auto-discovery from templates/ folder)
await initializeActions();

// Start HTTP server (serves both Express and WebSocket)
httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║           AdMitra Agent Server                 ║
╠════════════════════════════════════════════════╣
║  🎨 Server: http://localhost:${PORT}             ║
║  🔌 WebSocket: ws://localhost:${PORT}/ws         ║
║                                                ║
║  REST Endpoints:                               ║
║  GET  /health                - Health check    ║
║  POST /upload                - Upload images   ║
║  GET  /sessions              - List sessions   ║
║  GET  /sessions/:id          - Session info    ║
║  GET  /sessions/:id/pipeline - Pipeline status ║
║  GET  /sessions/:id/assets   - Get assets      ║
║  POST /sessions/:id/cancel   - Cancel          ║
║                                                ║
║  WebSocket Messages (client → server):         ║
║  { type: 'chat', content, images? }            ║
║  { type: 'continue', sessionId, content? }     ║
║  { type: 'cancel', sessionId }                 ║
║  { type: 'subscribe', sessionId }              ║
║  { type: 'execute_action', instanceId, params }║
║  { type: 'continue_action', instanceId }       ║
║  { type: 'question_answer', questionId, ...}   ║
╠════════════════════════════════════════════════╣
║  Environment:                                  ║
║  - Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Missing'}           ║
║  - FAL API: ${process.env.FAL_KEY ? '✅ Configured' : '❌ Missing'}                  ║
╚════════════════════════════════════════════════╝
  `);
});
