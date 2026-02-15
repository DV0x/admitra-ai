import { WebSocketHandler, type WSServerMessage } from './websocket-handler.js';
import { SDKInstrumentor } from './instrumentor.js';
import { SessionManager } from './session-manager.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator-prompt.js';
import { AIClient } from './ai-client.js';

/**
 * handleSDKStreaming - Extracted streaming handler for SDK query results
 *
 * Processes stream events from AIClient.queryWithSession() and broadcasts
 * block-level events to WebSocket subscribers. Replaces the 3x duplicated
 * streaming blocks in the original sdk-server.ts.
 */
export async function handleSDKStreaming(
  aiClient: AIClient,
  prompt: string,
  sessionId: string,
  wsHandler: WebSocketHandler,
  instrumentor: SDKInstrumentor,
  sessionManager: SessionManager,
  options?: {
    systemPrompt?: string;
    imagePaths?: string[];
  }
): Promise<{ assistantText: string; stopReason: string }> {
  const assistantMessages: string[] = [];
  let toolInputBuffer: Record<number, string> = {};
  let toolStartTimes: Record<number, number> = {};
  let hintSent = false;
  let lastStopReason = 'end_turn';

  const systemPrompt = options?.systemPrompt || ORCHESTRATOR_SYSTEM_PROMPT;

  for await (const result of aiClient.queryWithSession(prompt, sessionId, { systemPrompt }, options?.imagePaths)) {
    const { message } = result;
    instrumentor.processMessage(message);

    // Stream to WebSocket - block-level events
    // SDKPartialAssistantMessage provides metadata: uuid, session_id, parent_tool_use_id
    if (message.type === 'stream_event') {
      const streamMsg = message as any;
      const event = streamMsg.event;
      // parent_tool_use_id: null = main agent, non-null = subagent output
      const isSubagent = streamMsg.parent_tool_use_id != null;

      switch (event?.type) {
        case 'content_block_start': {
          const blockType = event.content_block?.type;
          const blockIndex = event.index;

          const blockStartEvent = {
            type: 'block_start',
            blockIndex,
            blockType: blockType || 'text',
            toolName: blockType === 'tool_use' ? event.content_block?.name : undefined,
            toolId: blockType === 'tool_use' ? event.content_block?.id : undefined,
          };
          wsHandler.broadcastToSession(sessionId, blockStartEvent as WSServerMessage);

          if (blockType === 'tool_use') {
            toolInputBuffer[blockIndex] = '';
            toolStartTimes[blockIndex] = Date.now();
            if (!hintSent) {
              wsHandler.broadcastToSession(sessionId, { type: 'message_type_hint', messageType: 'thinking' });
              hintSent = true;
            }
          }
          break;
        }

        case 'content_block_delta': {
          const blockIndex = event.index;
          const deltaText = event.delta?.text;
          const inputJsonDelta = event.delta?.partial_json;

          if (deltaText || inputJsonDelta) {
            const blockDeltaEvent = {
              type: 'block_delta',
              blockIndex,
              text: deltaText || '',
              inputJsonDelta: inputJsonDelta || undefined,
            };
            wsHandler.broadcastToSession(sessionId, blockDeltaEvent as WSServerMessage);

            if (inputJsonDelta && toolInputBuffer[blockIndex] !== undefined) {
              toolInputBuffer[blockIndex] += inputJsonDelta;
            }
          }
          break;
        }

        case 'content_block_stop': {
          const blockIndex = event.index;

          let parsedToolInput: Record<string, unknown> | undefined;
          let toolDuration: number | undefined;
          if (toolInputBuffer[blockIndex] !== undefined) {
            try {
              parsedToolInput = JSON.parse(toolInputBuffer[blockIndex]);
            } catch (e) {
              // JSON parsing failed
            }
            if (toolStartTimes[blockIndex]) {
              toolDuration = Date.now() - toolStartTimes[blockIndex];
            }
            delete toolInputBuffer[blockIndex];
            delete toolStartTimes[blockIndex];
          }

          const blockEndEvent = {
            type: 'block_end',
            blockIndex,
            toolInput: parsedToolInput,
            toolDuration,
          };
          wsHandler.broadcastToSession(sessionId, blockEndEvent as WSServerMessage);
          break;
        }

        case 'message_start': {
          wsHandler.broadcastToSession(sessionId, { type: 'message_start' } as WSServerMessage);
          break;
        }

        case 'message_stop': {
          const stopReason = event.message?.stop_reason || event.stop_reason || 'end_turn';
          lastStopReason = stopReason;
          console.log(`📍 [MESSAGE_STOP] stop_reason: ${stopReason}`, event.message ? 'has message' : 'no message');
          wsHandler.broadcastToSession(sessionId, { type: 'message_stop', stopReason } as WSServerMessage);
          break;
        }
      }
    } else if (message.type === 'assistant') {
      // Collect assistant messages for final response (used in 'complete' event)
      const msgContent = (message as any).message?.content;
      if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          if (block.type === 'text' && block.text) {
            assistantMessages.push(block.text);
          }
        }
      }
      // Reset for next message
      hintSent = false;
    } else if (message.type === 'system') {
      wsHandler.broadcastToSession(sessionId, { type: 'system', subtype: (message as any).subtype, data: message });
    } else if (message.type === 'result') {
      // Send completion event (action proposals handled separately via actionEmitter)
      wsHandler.broadcastToSession(sessionId, {
        type: 'complete',
        sessionId,
        response: assistantMessages[assistantMessages.length - 1] || '',
        sessionStats: sessionManager.getSessionStats(sessionId),
        pipeline: sessionManager.getPipelineStatus(sessionId),
        instrumentation: instrumentor.getCampaignReport()
      });
    }
  }

  return {
    assistantText: assistantMessages[assistantMessages.length - 1] || '',
    stopReason: lastStopReason
  };
}
