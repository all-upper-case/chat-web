import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import Chat from './components/Chat';

export default function App() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

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
        {user ? <Chat /> : <div className="p-6 text-zinc-600">Sign in to start chatting.</div>}
      </main>
    </div>
  );
}
