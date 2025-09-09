import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SettingsRow, Message } from '../lib/types';

const MODELS = [
  { id: 'mistral-large-latest', name: 'Mistral Large' },
  { id: 'mistral-8b-latest', name: 'Mistral 8B' },
  { id: 'mistral-3b-latest', name: 'Mistral 3B' },
  { id: 'codestral-latest', name: 'Codestral (code)' },
  { id: 'pixtral-12b-2409', name: 'Pixtral 12B' }
];

export default function Settings({
  conversationId,
  isOpen,
  onClose,
  onChanged
}: {
  conversationId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void; // signal settings or system prompt changed
}) {
  const [row, setRow] = useState<Partial<SettingsRow>>({
    model: 'mistral-large-latest',
    temperature: 0.7,
    max_tokens: 2048,
    safe_prompt: false
  });

  const [systemPrompt, setSystemPrompt] = useState<string>('');

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const { data } = await supabase.from('settings').select('*').eq('user_id', auth.user.id).maybeSingle();
      if (data) setRow(data as SettingsRow);

      // load system prompt (message idx 0)
      if (conversationId) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('idx')
          .limit(1);
        const sys = (msgs?.[0] as Message | undefined);
        setSystemPrompt(sys?.content || 'You are a helpful assistant.');
      }
    })();
  }, [conversationId, isOpen]);

  const saveSettings = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    const payload = {
      user_id: auth.user.id,
      model: row.model || 'mistral-large-latest',
      temperature: Number(row.temperature ?? 0.7),
      max_tokens: Number(row.max_tokens ?? 2048),
      safe_prompt: Boolean(row.safe_prompt)
    };
    await supabase.from('settings').upsert(payload);
    onChanged();
  };

  const saveSystemPrompt = async () => {
    if (!conversationId) return;
    // Update message idx 0 (system)
    const { data: sysMsg } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('idx', 0)
      .limit(1);
    const m = sysMsg?.[0] as Message | undefined;
    if (!m) return;
    await supabase.from('messages').update({ content: systemPrompt }).eq('id', m.id as string);
    onChanged();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40">
      <div className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-white shadow-xl flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Settings</div>
          <button className="px-3 py-1 rounded border" onClick={onClose}>Close</button>
        </div>

        <div className="p-4 space-y-6 overflow-auto">
          <section>
            <div className="font-medium mb-2">Model</div>
            <select
              className="w-full border rounded p-2"
              value={row.model}
              onChange={(e) => setRow((r) => ({ ...r, model: e.target.value }))}
            >
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
            </select>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div>
              <div className="font-medium mb-2">Temperature</div>
              <input
                type="number" step="0.1" min="0" max="2"
                className="w-full border rounded p-2"
                value={row.temperature ?? 0.7}
                onChange={(e) => setRow((r) => ({ ...r, temperature: Number(e.target.value) }))}
              />
            </div>
            <div>
              <div className="font-medium mb-2">Max tokens</div>
              <input
                type="number" min="1" max="8192"
                className="w-full border rounded p-2"
                value={row.max_tokens ?? 2048}
                onChange={(e) => setRow((r) => ({ ...r, max_tokens: Number(e.target.value) }))}
              />
            </div>
          </section>

          <section>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!row.safe_prompt}
                onChange={(e) => setRow((r) => ({ ...r, safe_prompt: e.target.checked }))}
              />
              <span>safe_prompt</span>
            </label>
          </section>

          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={saveSettings}>Save Settings</button>
            <button className="px-3 py-2 rounded border" onClick={onClose}>Close</button>
          </div>

          <hr className="my-2" />

          <section>
            <div className="font-medium mb-2">System prompt</div>
            <textarea
              className="w-full border rounded p-2"
              rows={10}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
            <div className="mt-2">
              <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={saveSystemPrompt}>Save System Prompt</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
