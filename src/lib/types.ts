export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  id?: string;
  conversation_id?: string;
  role: Role;
  content: string;
  idx: number;
  created_at?: string;
  updated_at?: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
