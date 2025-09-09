import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Conversations({ userId, onOpen }: { userId: string, onOpen: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (!ignore) {
        if (error) console.error('[conversations] list error', error);
        setItems(data ?? []);
        setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [userId]);

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-2 space-y-1">
      <button
        className="w-full text-left p-2 rounded bg-blue-600 text-white"
        onClick={async () => {
          const { data, error } = await supabase
            .from('conversations')
            .insert({ user_id: userId, title: 'New chat' })
            .select('id')
            .single();
          if (error) { console.error('[conversations] create error', error); return; }
          onOpen(data!.id);
        }}
      >
        + New chat
      </button>

      {items.map((c) => (
        <button
          key={c.id}
          className="w-full text-left p-2 rounded hover:bg-gray-100 border"
          onClick={() => onOpen(c.id)}
        >
          <div className="font-medium truncate">{c.title || 'Untitled chat'}</div>
          <div className="text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</div>
        </button>
      ))}
    </div>
  );
}

