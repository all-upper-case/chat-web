import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import Chat from './components/Chat';
import Conversations from './components/Conversations';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data[0]) setConversationId(data[0].id);
    })();
  }, [user]);

  const signIn = async () => {
    const email = prompt('Enter email for magic link:')?.trim();
    if (!email) return;
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    alert('Check your email for the magic link.');
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 bg-white border-b px-4 py-2 flex items-center justify-between">
        <span className="font-semibold">Chat</span>
        <div className="space-x-2">
          {user ? (
            <>
              <span className="text-sm text-zinc-500">{user.email}</span>
              <button className="px-3 py-1 rounded bg-zinc-100" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={signIn}>Sign in</button>
          )}
        </div>
      </header>
      <main className="flex-1 min-h-0">
        {user ? (
          <div className="flex h-full">
            <aside className="w-72 border-r overflow-y-auto">
              <Conversations userId={user.id} onOpen={setConversationId} />
            </aside>
            <section className="flex-1 overflow-hidden">
              {conversationId ? (
                <Chat conversationId={conversationId} />
              ) : (
                <div className="p-6 text-gray-500">Pick or create a chat from the left.</div>
              )}
            </section>
          </div>
        ) : (
          <div className="p-6 text-zinc-600">Sign in to start chatting.</div>
        )}
      </main>
    </div>
  );
}
