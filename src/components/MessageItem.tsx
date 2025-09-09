import React, { useState } from 'react';
import type { Message } from '../lib/types';

export default function MessageItem({
  m, i, onSave, onDelete, onRegen,
}: { m: Message; i: number; onSave: (i: number, text: string) => void; onDelete: () => void; onRegen: () => void; }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.content);
  const isSystem = m.role === 'system';
  const bubble = m.role === 'user' ? 'bg-blue-100' : m.role === 'assistant' ? 'bg-zinc-200' : 'bg-white border border-dashed';

  return (
    <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-2xl px-3 py-2 ${bubble}`}>
        <div className="text-xs text-zinc-500 mb-1">[{i}] {m.role[0].toUpperCase()}</div>
        {!editing ? (
          <div className="whitespace-pre-wrap">{m.content}</div>
        ) : (
          <textarea
            className="w-full p-2 border rounded bg-white"
            rows={Math.min(10, Math.max(3, Math.ceil(val.length / 60)))}
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
        )}
        <div className="mt-2 space-x-2 text-sm">
          {!isSystem && !editing && (
            <>
              <button className="px-2 py-1 rounded border" onClick={() => setEditing(true)}>Edit</button>
              <button className="px-2 py-1 rounded border" onClick={onRegen}>Regen</button>
              <button className="px-2 py-1 rounded border text-red-600" onClick={onDelete}>Delete</button>
            </>
          )}
          {editing && (
            <>
              <button className="px-2 py-1 rounded bg-blue-600 text-white" onClick={() => { onSave(i, val); setEditing(false); }}>Save</button>
              <button className="px-2 py-1 rounded border" onClick={() => { setVal(m.content); setEditing(false); }}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
