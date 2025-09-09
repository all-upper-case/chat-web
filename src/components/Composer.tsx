import React, { useRef, useState } from 'react';

export default function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    ref.current?.focus();
  };

  return (
    <div className="sticky bottom-0 bg-white border-t px-3 py-2">
      <div className="flex gap-2">
        <textarea
          ref={ref}
          className="flex-1 resize-none border rounded p-2"
          rows={2}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="rounded px-4 bg-blue-600 text-white" onClick={submit}>Send</button>
      </div>
    </div>
  );
}
