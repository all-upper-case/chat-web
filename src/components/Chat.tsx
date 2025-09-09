import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Message } from '../lib/types';
import MessageItem from './MessageItem';
import Composer from './Composer';

/** Simple helper to timestamp console logs */
const ts = () => new Date().toISOString();

/** Writes to console + returns the same message for chaining */
function log(...args: any[]) {
  console.log(`[${ts()}]`, ...args);
}

/** Writes errors to console.error */
function logError(label: string, err: any) {
  console.error(`[${ts()}] ${label}:`, err);
}

async function ensureConversation(): Promise<{ id: string } | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      log('ensureConversation: no user yet (not signed in?)');
      return null;
    }

    // Most-recent conversation
    const { data: convs, error: convErr } = await supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (convErr) {
      logError('ensureConversation: select conversations failed', convErr);
      return null;
    }

    let conv = convs?.[0];
    if (!conv) {
      log('ensureConversation: creating new conversation…');
      const { data: ins, error: insErr } = await supabase
        .from('conversations')
        .insert({ user_id: auth.user.id })
        .select('*')
        .single();

      if (insErr || !ins) {
        logError('ensureConversation: insert conversation failed', insErr);
        return null;
      }
      conv = ins;

      // Seed a system prompt as the first row
      const system = 'You are a helpful assistant.';
      const { error: seedErr } = await supabase.from('messages').insert({
        conversation_id: conv.id,
        role: 'system',
        content: system,
        idx: 0,
      });
      if (seedErr) {
        logError('ensureConversation: seeding system message failed', seedErr);
      }
    }

    return { id: conv.id as string };
  } catch (e) {
    logError('ensureConversation: unexpected', e);
    return null;
  }
}

/** Full reload of a conversation’s messages ordered by idx */
async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('idx');

  if (error) {
    logError('fetchMessages failed', error);
    return [];
  }
  return (data as Message[]) || [];
}

/** Calls Netlify function and returns { content } or throws */
async function callAssistant(messages: { role: string; content: string }[]) {
  log('callAssistant: POST /api/chat payload', messages);
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    logError(`callAssistant: HTTP ${resp.status}`, text);
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }

  try {
    const data = JSON.parse(text);
    log('callAssistant: success, usage', data?.usage);
    return { content: data?.content ?? '' };
  } catch (e) {
    logError('callAssistant: JSON parse error', { textSnippet: text.slice(0, 500) });
    throw e;
  }
}

export default function Chat() {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('Ready');
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Smooth scroll to bottom when messages change */
  useEffect(() => {
    queueMicrotask(() => {
      try {
        scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' });
      } catch {
        /* no-op */
      }
    });
  }, [messages]);

  /** Initial load: make sure a conversation exists, then fetch messages */
  useEffect(() => {
    (async () => {
      setStatus('Ensuring conversation…');
      const conv = await ensureConversation();
      if (!conv) {
        setStatus('Failed to create/load conversation (check console).');
        return;
      }
      setConvId(conv.id);
      setStatus('Loading messages…');
      const msgs = await fetchMessages(conv.id);
      setMessages(msgs);
      setStatus('Ready');
      log('Initial messages', msgs);
    })();
  }, []);

  /** Full reload from DB */
  const reload = async () => {
    if (!convId) return;
    setStatus('Reloading…');
    const msgs = await fetchMessages(convId);
    setMessages(msgs);
    setStatus('Ready');
  };

  /** Sends a user message, calls assistant, updates DB + UI with strong logging */
  const send = async (text: string) => {
    if (!convId) {
      alert('No conversation yet. Try refreshing.');
      return;
    }
    const content = text.trim();
    if (!content) return;

    const userIdx = messages.length;
    const userMsg: Message = {
      conversation_id: convId,
      role: 'user',
      content,
      idx: userIdx,
    };

    // 1) Optimistic UI
    setMessages((prev) => prev.concat([{ ...userMsg } as any]));
    setStatus('Sending…');
    log('send: optimistic append (user)', userMsg);

    // 2) Persist user message (fire-and-forget)
    try {
      const { error } = await supabase.from('messages').insert(userMsg);
      if (error) logError('send: insert user failed', error);
    } catch (e) {
      logError('send: insert user threw', e);
    }

    // 3) Build assistant payload and call server
    try {
      const payload = messages
        .concat([{ role: 'user', content, idx: userIdx } as any])
        .map((m) => ({ role: m.role, content: m.content }));

      const { content: assistantText } = await callAssistant(payload);

      const assistantMsg: Message = {
        conversation_id: convId,
        role: 'assistant',
        content: assistantText || '(no content)',
        idx: userIdx + 1,
      };

      // 4) Optimistic append assistant + persist
      setMessages((prev) => prev.concat([{ ...assistantMsg } as any]));
      log('send: optimistic append (assistant)', assistantMsg);

      const { error: insErr } = await supabase.from('messages').insert(assistantMsg);
      if (insErr) logError('send: insert assistant failed', insErr);

      setStatus('Ready');
    } catch (e: any) {
      logError('send: callAssistant failed', e);
      setStatus('Assistant call failed (see console).');
      alert(`Assistant error:\n${String(e).slice(0, 600)}`);
      // Keep UI consistent with DB
      await reload();
    }
  };

  /** Save an inline edit (no model call) */
  const saveEdit = async (i: number, text: string) => {
    const m = messages[i];
    if (!m) return;
    if (!m.id) {
      // If no id (optimistic-only), reload to sync and get IDs, then try again
      await reload();
      const mm = messages[i];
      if (!mm?.id) {
        alert('Could not edit yet—try again after a second.');
        return;
      }
    }

    const newText = text ?? '';
    setStatus('Saving edit…');
    log('saveEdit: updating row', { id: m.id, i, role: m.role });

    try {
      const { error } = await supabase.from('messages').update({ content: newText }).eq('id', m.id as string);
      if (error) {
        logError('saveEdit: update failed', error);
        alert(`Edit failed: ${error.message ?? error}`);
      } else {
        setMessages((prev) => {
          const copy = prev.slice();
          copy[i] = { ...copy[i], content: newText };
          return copy;
        });
      }
    } catch (e) {
      logError('saveEdit: update threw', e);
      alert(`Edit error: ${String(e).slice(0, 400)}`);
    } finally {
      setStatus('Ready');
    }
  };

  /** Delete a message and re-pack idx to keep a clean sequence */
  const deleteMsg = async (i: number) => {
    const m = messages[i];
    if (!m) return;
    if (i === 0) {
      alert('The system message cannot be deleted.');
      return;
    }
    if (!m.id) {
      await reload();
    }

    setStatus('Deleting…');
    log('deleteMsg: deleting row', { id: m.id, i, role: m.role });

    try {
      const { error: delErr } = await supabase.from('messages').delete().eq('id', m.id as string);
      if (delErr) {
        logError('deleteMsg: delete failed', delErr);
        alert(`Delete failed: ${delErr.message ?? delErr}`);
        setStatus('Ready');
        return;
      }

      // Re-fetch and re-index to avoid gaps
      const list = await fetchMessages(convId!);
      for (let j = 0; j < list.length; j++) {
        const row = list[j];
        if (row.idx !== j) {
          const { error: updErr } = await supabase.from('messages').update({ idx: j }).eq('id', row.id as string);
          if (updErr) logError('deleteMsg: reindex failed', updErr);
        }
      }
      await reload();
    } catch (e) {
      logError('deleteMsg: threw', e);
      alert(`Delete error: ${String(e).slice(0, 400)}`);
    } finally {
      setStatus('Ready');
    }
  };

  /** Regenerate from the selected turn */
  const regenFrom = async (i: number) => {
    if (!convId) return;
    const target = messages[i];
    if (!target) return;

    const cutAt = target.role === 'assistant' ? i - 1 : i; // keep up to user message
    if (cutAt < 0) {
      alert('Cannot regenerate before the first user turn.');
      return;
    }

    setStatus('Regenerating…');
    log('regenFrom: cutting at index', { i, cutAt, targetRole: target.role });

    try {
      // Delete tail (everything after cutAt)
      const tail = messages.slice(cutAt + 1);
      for (const t of tail) {
        if (t.id) {
          const { error: delErr } = await supabase.from('messages').delete().eq('id', t.id as string);
          if (delErr) logError('regenFrom: delete tail failed', delErr);
        }
      }

      // Build payload from kept messages
      const kept = messages.slice(0, cutAt + 1).map((m) => ({ role: m.role, content: m.content }));
      const { content } = await callAssistant(kept);

      const newAssistant: Message = {
        conversation_id: convId,
        role: 'assistant',
        content: content || '(no content)',
        idx: cutAt + 1,
      };

      // Optimistic append + persist
      setMessages((prev) => prev.slice(0, cutAt + 1).concat([{ ...newAssistant } as any]));
      const { error: insErr } = await supabase.from('messages').insert(newAssistant);
      if (insErr) logError('regenFrom: insert new assistant failed', insErr);

      setStatus('Ready');
    } catch (e) {
      logError('regenFrom: failed', e);
      alert(`Regen error: ${String(e).slice(0, 600)}`);
      await reload();
      setStatus('Ready');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tiny status/debug bar (stays readable on mobile) */}
      <div className="sticky top-0 z-10 bg-amber-50 text-amber-800 border-b border-amber-200 px-3 py-1 text-xs">
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
    </div>
  );
}
