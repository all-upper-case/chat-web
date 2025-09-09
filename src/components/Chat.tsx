import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Conversation, Message, SettingsRow } from '../lib/types';
import MessageItem from './MessageItem';
import Composer from './Composer';
import Settings from './Settings';

const ts = () => new Date().toISOString();
const SUMMARIZE_AFTER = 20;   // when total rows exceed this, we start summarizing
const KEEP_RECENT = 10;       // keep this many most recent rows verbatim when summarizing

function log(...args: any[]) { console.log(`[${ts()}]`, ...args); }
function logError(label: string, err: any) { console.error(`[${ts()}] ${label}:`, err); }

async function fetchMessages(conversation_id: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true });
  if (error) { logError('fetchMessages', error); return []; }
  return (data as Message[]) || [];
}

async function loadSettings(): Promise<Partial<SettingsRow>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase.from('settings').select('*').eq('user_id', user.id).maybeSingle();
  return (data as SettingsRow) || {};
}

export default function Chat({ conversationId }: { conversationId: string }) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('Ready');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Partial<SettingsRow>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9 })); }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      setStatus('Loading conversation…');
      const { data: convRow, error } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
      if (error) { logError('load conversation', error); setStatus('Failed to load conversation'); return; }
      setConv(convRow as Conversation);

      let msgs = await fetchMessages(conversationId);
      if (msgs.length === 0) {
        const { error: seedErr } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'system',
          content: 'You are a helpful assistant.',
          idx: 0
        });
        if (seedErr) logError('seed system', seedErr);
        msgs = await fetchMessages(conversationId);
      }
      setMessages(msgs);
      setSettings(await loadSettings());
      setStatus('Ready');
    })();
  }, [conversationId]);

  const reload = async () => {
    if (!conversationId) return;
    setStatus('Reloading…');
    const convRes = await supabase.from('conversations').select('*').eq('id', conversationId).single();
    if (!convRes.error) setConv(convRes.data as Conversation);
    setMessages(await fetchMessages(conversationId));
    setSettings(await loadSettings());
    setStatus('Ready');
  };

  async function callAssistant(payloadMsgs: { role: string; content: string }[]) {
    const body = {
      messages: payloadMsgs,
      model: settings.model || 'mistral-large-latest',
      temperature: settings.temperature ?? 0.7,
      max_tokens: settings.max_tokens ?? 2048,
      safe_prompt: settings.safe_prompt ?? false
    };
    log('callAssistant body', body);
    const resp = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await resp.text();
    if (!resp.ok) { logError(`callAssistant HTTP ${resp.status}`, text); throw new Error(text.slice(0, 600)); }
    const json = JSON.parse(text);
    return json.content as string;
  }

  /** If too long, summarize the older part and store in running_summary. */
  const maybeSummarize = async () => {
    if (!conv) return;
    if (messages.length <= SUMMARIZE_AFTER) return;

    setStatus('Summarizing older turns…');

    const keepHead = 1;
    const cutStart = keepHead;
    const cutEnd = Math.max(messages.length - KEEP_RECENT, keepHead);
    const middle = messages.slice(cutStart, cutEnd);
    if (middle.length === 0) { setStatus('Ready'); return; }

    const transcript = middle.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n\n');

    const resp = await fetch('/.netlify/functions/summarize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        model: settings.summarizer_model,
        prompt: settings.summarizer_prompt
      })
    });
    const txt = await resp.text();
    if (!resp.ok) { logError('summarize failed', txt); setStatus('Ready'); return; }
    const { summary } = JSON.parse(txt);

    const running = (conv.running_summary || '').trim();
    const newSummary = running ? `${running}\n\n${summary}` : summary;
    await supabase.from('conversations').update({ running_summary: newSummary }).eq('id', conv.id);

    for (const m of middle) await supabase.from('messages').delete().eq('id', m.id as string);
    const fresh = await fetchMessages(conversationId);
    for (let j = 0; j < fresh.length; j++) {
      if (fresh[j].idx !== j) await supabase.from('messages').update({ idx: j }).eq('id', fresh[j].id as string);
    }

    await reload();
  };

  const send = async (text: string) => {
    if (!conv) { alert('No conversation yet.'); return; }
    const content = text.trim(); if (!content) return;
    const userIdx = messages.length;

    const userMsg: Message = { conversation_id: conv.id, role: 'user', content, idx: userIdx };
    setMessages(prev => prev.concat([{ ...userMsg } as any]));
    setStatus('Sending…');

    supabase.from('messages').insert(userMsg).then(({ error }) => error && logError('insert user', error));

    const base = messages.concat([{ role: 'user', content, idx: userIdx } as any])
      .map(m => ({ role: m.role, content: m.content }));

    const payload = conv.running_summary
      ? [{ role: 'system', content: `Conversation so far (summary):\n${conv.running_summary}` }, ...base]
      : base;

    try {
      const assistantText = await callAssistant(payload);

      const assistantMsg: Message = {
        conversation_id: conv.id, role: 'assistant', content: assistantText || '(no content)', idx: userIdx + 1
      };
      setMessages(prev => prev.concat([{ ...assistantMsg } as any]));
      const { error: e2 } = await supabase.from('messages').insert(assistantMsg);
      if (e2) logError('insert assistant', e2);

      const nonSystem = messages.filter(m => m.role !== 'system').length;
      if (nonSystem === 0) {
        const title = content.replace(/\s+/g, ' ').slice(0, 60);
        supabase.from('conversations').update({ title }).eq('id', conv.id);
      }

      setStatus('Ready');

      await maybeSummarize();
    } catch (e: any) {
      logError('send callAssistant', e);
      setStatus('Assistant call failed');
      alert(`Assistant error:\n${String(e).slice(0, 600)}`);
      await reload();
    }
  };

  const saveEdit = async (i: number, text: string) => {
    const m = messages[i]; if (!m) return;
    if (!m.id) { await reload(); if (!messages[i]?.id) { alert('Could not edit yet—try again after a second.'); return; } }
    setStatus('Saving edit…');
    try {
      const { error } = await supabase.from('messages').update({ content: text ?? '' }).eq('id', m.id as string);
      if (error) { logError('saveEdit', error); alert(`Edit failed: ${error.message ?? error}`); }
      else setMessages(prev => { const c = prev.slice(); c[i] = { ...c[i], content: text ?? '' }; return c; });
    } finally { setStatus('Ready'); }
  };

  const deleteMsg = async (i: number) => {
    const m = messages[i]; if (!m) return;
    if (i === 0) { alert('Cannot delete the system message.'); return; }
    setStatus('Deleting…');
    try {
      if (!m.id) await reload();
      const { error } = await supabase.from('messages').delete().eq('id', m.id as string);
      if (error) { logError('delete', error); alert(`Delete failed: ${error.message ?? error}`); }
      const fresh = await fetchMessages(conversationId);
      for (let j = 0; j < fresh.length; j++) {
        if (fresh[j].idx !== j) await supabase.from('messages').update({ idx: j }).eq('id', fresh[j].id as string);
      }
      await reload();
    } finally { setStatus('Ready'); }
  };

  const regenFrom = async (i: number) => {
    if (!conv) return;
    const target = messages[i]; if (!target) return;

    const cutAt = target.role === 'assistant' ? i - 1 : i;
    if (cutAt < 0) { alert('Cannot regenerate before first user turn.'); return; }

    setStatus('Regenerating…');
    for (const t of messages.slice(cutAt + 1)) { if (t.id) await supabase.from('messages').delete().eq('id', t.id as string); }

    const kept = messages.slice(0, cutAt + 1).map(m => ({ role: m.role, content: m.content }));
    const payload = conv.running_summary
      ? [{ role: 'system', content: `Conversation so far (summary):\n${conv.running_summary}` }, ...kept]
      : kept;

    try {
      const content = await callAssistant(payload);
      const newAssistant: Message = { conversation_id: conv.id, role: 'assistant', content: content || '(no content)', idx: cutAt + 1 };
      setMessages(prev => prev.slice(0, cutAt + 1).concat([{ ...newAssistant } as any]));
      await supabase.from('messages').insert(newAssistant);
    } catch (e) {
      logError('regenFrom', e);
      alert(`Regen error: ${String(e).slice(0, 600)}`);
    } finally {
      await reload();
      setStatus('Ready');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 bg-white border-b px-4 py-2 flex items-center justify-between">
        <span className="font-semibold">Chat</span>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded border" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>

      <div className="sticky top-[41px] z-10 bg-amber-50 text-amber-800 border-b border-amber-200 px-3 py-1 text-xs">
        {status}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-2">
        {messages.map((m, i) => (
          <MessageItem
            key={m.id || `${m.role}-${i}`}
            m={m}
            i={i}
            onSave={saveEdit}
            onDelete={() => deleteMsg(i)}
            onRegen={() => regenFrom(i)}
          />
        ))}
      </div>

      <Composer onSend={send} />

      <Settings
        conversationId={conv?.id ?? null}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={reload}
      />
    </div>
  );
}

