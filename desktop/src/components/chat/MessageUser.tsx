import React from 'react';
import { User } from 'lucide-react';

interface MessageUserProps {
  content: string;
  timestamp?: string;
}

const MessageUser: React.FC<MessageUserProps> = ({ content, timestamp }) => {
  return (
    <div className="message-enter flex justify-end max-w-3xl mx-auto px-8 py-6">
      <div className="flex flex-col items-end flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          {timestamp && (
            <span className="text-xs text-[var(--anzar-text-muted)]">
              {timestamp}
            </span>
          )}
          <span className="text-sm font-medium text-[var(--anzar-text)] flex items-center gap-1">
            <User size={12} />
            You
          </span>
        </div>

        <div 
          className="rounded-2xl rounded-br-sm p-5 max-w-[85%]"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <p className="text-[var(--anzar-text)] text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        </div>
      </div>
    </div>
  );
};

export default MessageUser;