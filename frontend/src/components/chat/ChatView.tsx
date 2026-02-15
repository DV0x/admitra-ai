import { useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage, ImageMessage as ImageMessageType, VideoMessage as VideoMessageType, ToolUseMessage as ToolUseMessageType, ActionMessage as ActionMessageType, QuestionMessage as QuestionMessageType } from '../../lib/types';
import { TextMessage } from './TextMessage';
import { ThinkingMessage } from './ThinkingMessage';
import { ImageMessage } from './ImageMessage';
import { ImageGrid } from './ImageGrid';
import { VideoGrid } from './VideoGrid';
import { ProgressMessage } from './ProgressMessage';
import { VideoMessage } from './VideoMessage';
import { ToolUseBlock } from './ToolUseBlock';
import { ActionCard } from './ActionCard';
import { QuestionCard } from './QuestionCard';
import { ContinueButton } from './ContinueButton';

interface ChatViewProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  activity?: string | null;
  // Action Instance Pattern
  awaitingContinuation?: boolean;
  executingActionId?: string | null;
  onExecuteAction?: (instanceId: string, params: Record<string, unknown>, originalParams: Record<string, unknown>) => void;
  onContinueAction?: (instanceId: string) => void;
  onContinue?: () => void;
  onSend?: (message: string) => void;
  onAnswerQuestion?: (questionId: string, answers: Record<string, string>) => void;
}

// Group consecutive image/video messages for grid display
type MessageGroup =
  | { type: 'single'; message: ChatMessage }
  | { type: 'image-grid'; images: ImageMessageType[] }
  | { type: 'video-grid'; videos: VideoMessageType[] };

function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentImageGroup: ImageMessageType[] = [];
  let currentVideoGroup: VideoMessageType[] = [];

  const flushImageGroup = () => {
    if (currentImageGroup.length >= 3) {
      // 3+ consecutive images → show as grid
      groups.push({ type: 'image-grid', images: [...currentImageGroup] });
    } else {
      // 1-2 images → show individually
      currentImageGroup.forEach((img) => {
        groups.push({ type: 'single', message: img });
      });
    }
    currentImageGroup = [];
  };

  const flushVideoGroup = () => {
    if (currentVideoGroup.length >= 3) {
      // 3+ consecutive videos → show as grid
      groups.push({ type: 'video-grid', videos: [...currentVideoGroup] });
    } else {
      // 1-2 videos → show individually
      currentVideoGroup.forEach((vid) => {
        groups.push({ type: 'single', message: vid });
      });
    }
    currentVideoGroup = [];
  };

  for (const message of messages) {
    if (message.type === 'image') {
      flushVideoGroup(); // Flush any pending videos first
      currentImageGroup.push(message);
    } else if (message.type === 'video') {
      flushImageGroup(); // Flush any pending images first
      currentVideoGroup.push(message);
    } else {
      flushImageGroup();
      flushVideoGroup();
      groups.push({ type: 'single', message });
    }
  }
  flushImageGroup();
  flushVideoGroup();

  return groups;
}

export function ChatView({
  messages,
  isGenerating,
  activity,
  awaitingContinuation = false,
  executingActionId = null,
  onExecuteAction,
  onContinueAction,
  onContinue,
  onSend,
  onAnswerQuestion,
}: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingContinuation]);

  // Group consecutive images for grid display
  const messageGroups = useMemo(() => groupMessages(messages), [messages]);

  // Find the last action message that's awaiting continuation
  const lastAwaitingAction = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'action' && (msg as ActionMessageType).awaitingContinuation) {
        return msg as ActionMessageType;
      }
    }
    return null;
  }, [messages]);

  const renderMessage = (message: ChatMessage) => {
    switch (message.type) {
      case 'text':
        return <TextMessage message={message} />;
      case 'thinking':
        return <ThinkingMessage message={message} />;
      case 'image':
        return <ImageMessage message={message} />;
      case 'progress':
        return <ProgressMessage message={message} />;
      case 'video':
        return <VideoMessage message={message} />;
      case 'tool_use':
        return <ToolUseBlock message={message as ToolUseMessageType} isExecuting={isGenerating} />;
      case 'action':
        return (
          <ActionCard
            message={message as ActionMessageType}
            onExecute={onExecuteAction || (() => {})}
            isExecuting={executingActionId === (message as ActionMessageType).instance.instanceId}
          />
        );
      case 'question':
        return (
          <QuestionCard
            message={message as QuestionMessageType}
            onAnswer={onAnswerQuestion || (() => {})}
          />
        );
      default:
        return null;
    }
  };

  const renderGroup = (group: MessageGroup) => {
    if (group.type === 'image-grid') {
      return (
        <motion.div
          key={`image-grid-${group.images[0].id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          <ImageGrid images={group.images} />
        </motion.div>
      );
    }
    if (group.type === 'video-grid') {
      return (
        <motion.div
          key={`video-grid-${group.videos[0].id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          <VideoGrid videos={group.videos} />
        </motion.div>
      );
    }
    return (
      <motion.div
        key={group.message.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        {renderMessage(group.message)}
      </motion.div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
      <div className="space-y-5 max-w-2xl mx-auto">
        {/* Welcome message when empty */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16 rangoli-pattern"
          >
            <h2 className="font-display text-4xl text-text-primary mb-3">
              AdMitra
            </h2>
            <p className="text-text-secondary max-w-md mx-auto mb-8">
              AI Creative Agency for Bharat. Create stunning multilingual ads
              for your business in seconds.
            </p>

            {/* Quick-start suggestion chips */}
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'Diwali jewelry ad in Telugu',
                'Holi sale poster in Hindi',
                'Instagram story for my clothing shop',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSend?.(suggestion)}
                  className="px-4 py-2 rounded-full border border-border text-sm text-text-secondary
                             hover:border-accent hover:text-accent transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Messages - grouped for image grid display */}
        <AnimatePresence initial={false}>
          {messageGroups.map((group) => renderGroup(group))}
        </AnimatePresence>

        {/* Continue button when awaiting continuation */}
        {awaitingContinuation && !isGenerating && lastAwaitingAction && (
          <ContinueButton
            onClick={() => {
              if (onContinueAction) {
                onContinueAction(lastAwaitingAction.instance.instanceId);
              } else if (onContinue) {
                onContinue();
              }
            }}
            label="Continue"
          />
        )}

        {/* Thinking/Activity indicator with 3-dot animation */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 px-4 py-3 bg-surface shadow-sm rounded-2xl max-w-fit"
          >
            <div className="thinking-dots">
              <div className="thinking-dot" />
              <div className="thinking-dot" />
              <div className="thinking-dot" />
            </div>
            <span className="text-sm text-text-secondary">{activity || 'Thinking...'}</span>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
