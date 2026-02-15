import { useState } from 'react';
import { motion } from 'framer-motion';
import type { QuestionMessage } from '../../lib/types';

interface QuestionCardProps {
  message: QuestionMessage;
  onAnswer: (questionId: string, answers: Record<string, string>) => void;
}

export function QuestionCard({ message, onAnswer }: QuestionCardProps) {
  const { questionId, questions, isAnswered, answers: savedAnswers } = message;
  const [selections, setSelections] = useState<Record<string, string>>({});

  const handleOptionClick = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    setSelections(prev => {
      if (multiSelect) {
        const current = prev[questionText] || '';
        const labels = current ? current.split(', ') : [];
        const idx = labels.indexOf(optionLabel);
        if (idx >= 0) {
          labels.splice(idx, 1);
        } else {
          labels.push(optionLabel);
        }
        return { ...prev, [questionText]: labels.join(', ') };
      }
      return { ...prev, [questionText]: optionLabel };
    });
  };

  const isSelected = (questionText: string, optionLabel: string): boolean => {
    const val = selections[questionText] || '';
    return val.split(', ').includes(optionLabel);
  };

  const allAnswered = questions.every(q => selections[q.question]);

  const handleSubmit = () => {
    if (allAnswered) {
      onAnswer(questionId, selections);
    }
  };

  // Answered state
  if (isAnswered && savedAnswers) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white shadow-sm shadow-black/5 border border-border rounded-2xl p-4 max-w-lg"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-accent text-lg">&#10003;</span>
          <span className="text-sm font-medium text-text-primary">Questions answered</span>
        </div>
        {questions.map((q) => (
          <div key={q.question} className="mb-2 last:mb-0">
            <p className="text-xs text-text-muted">{q.header}</p>
            <p className="text-sm text-text-primary">{savedAnswers[q.question]}</p>
          </div>
        ))}
      </motion.div>
    );
  }

  // Active question state
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white shadow-md shadow-black/5 border-2 border-accent/30 rounded-2xl p-5 max-w-lg"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-accent text-lg">&#63;</span>
        <span className="text-sm font-medium text-text-primary">
          I have {questions.length === 1 ? 'a question' : `${questions.length} questions`} for you
        </span>
      </div>

      <div className="space-y-5">
        {questions.map((q) => (
          <div key={q.question}>
            <p className="text-sm font-medium text-text-primary mb-1">{q.question}</p>
            {q.header && (
              <span className="inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium mb-2">
                {q.header}
              </span>
            )}
            {q.multiSelect && (
              <p className="text-[11px] text-text-muted mb-2">Select all that apply</p>
            )}
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleOptionClick(q.question, opt.label, q.multiSelect)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all duration-150
                    ${isSelected(q.question, opt.label)
                      ? 'bg-accent text-white border-accent shadow-sm'
                      : 'bg-surface border-border text-text-primary hover:border-accent/50 hover:bg-accent/5'
                    }`}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className={`mt-4 w-full py-2 rounded-xl text-sm font-medium transition-all duration-200
          ${allAnswered
            ? 'bg-accent text-white hover:bg-accent-hover shadow-sm'
            : 'bg-surface-elevated text-text-muted cursor-not-allowed'
          }`}
      >
        Submit Answers
      </button>
    </motion.div>
  );
}
