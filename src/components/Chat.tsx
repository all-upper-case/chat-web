import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Message } from '../lib/types';
import MessageItem from './MessageItem';
import Composer from './Composer';

async function ensureConversation() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get latest conversation
  const { data: convs } = await supabase.from('conversations').select('*')
    .order('created_at', { ascending: false }).limit(1);
  let conv = convs?.[0];

  if (!conv) {
    const system = "You are a helpful assistant.";
    const { data: ins } = await supabase.from('conversations')
      .insert({ user_id: user.id }).select('*').single();
    conv = ins!;
    await supabase.from('messages').insert({
      conversation_id: conv.id, role: 'system', content: system, idx: 0
    });
  }
  return conv;
}

export default function Chat() {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const conv = await ensureConversation();
      if (!conv) return;
      setConvId(conv.id);
      await load(conv.id);
    })();
    async function load(id: string) {
      const { data } = await supabase.from('messages').select('*').eq('conversation_id', id).order('idx');
      setMessages((data as Message[]) || []);
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));
    }
  }, []);

  const reload = async () => {
    if (!convId) return;
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('idx');
    setMessages((data as Message[]) || []);
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));
  };

  const callServer = async (msgs: {role: string; content: string}[]) => {
    const resp = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs })
    });
    return await resp.json();
  };

  const send = async (text: string) => {
    if (!convId || !text.trim()) return;
    const idx = messages.length;
    await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: text, idx });
    const payload = messages.concat([{ role: 'user', content: text, idx }]).map(m => ({ role: m.role, content: m.content }));
    const data = await callServer(payload);
    const content = data.content || '(no content)';
    await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content, idx: idx + 1 });
    await reload();
  };

  const saveEdit = async (i: number, text: string) => {
    const m = messages[i]; if (!m) return;
    await supabase.from('messages').update({ content: text }).eq('id', m.id);
    await reload();
  };

  const deleteMsg = async (i: number) => {
    const m = messages[i]; if (!m || i === 0) return; // keep system
    await supabase.from('messages').delete().eq('id', m.id);
    // Re-pack idx to keep order clean
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('idx');
    const list = (data as Message[]) || [];
    for (let j = 0; j < list.length; j++) {
      await supabase.from('messages').update({ idx: j }).eq('id', list[j].id);
    }
    await reload();
  };

  const regenFrom = async (i: number) => {
    if (!convId) return;
    const target = messages[i]; if (!target) return;
    const cutAt = target.role === 'assistant' ? i - 1 : i;
    // Delete tail
    const tail = messages.slice(cutAt + 1);
    for (const t of tail) await supabase.from('messages').delete().eq('id', t.id);
    // Build payload from kept messages
    const kept = messages.slice(0, cutAt + 1).map(m => ({ role: m.role, content: m.content }));
    const data = await callServer(kept);
    const content = data.content || '(no content)';
    await supabase.from('messages').insert({
      conversation_id: convId, role: 'assistant', content, idx: cutAt + 1
    });
    await reload();
  };

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-2">
        {messages.map((m, i) => (
          <MessageItem
            key={m.id || i}
            m={m}
            i={i}
            onSave={saveEdit}
            onDelete={() => deleteMsg(i)}
            onRegen={() => regenFrom(i)}
          />
        ))}
      </div>
      <Composer onSend={send} />
    </div>
  );
}
