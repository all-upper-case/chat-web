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
  running_summary?: string;
}

export interface SettingsRow {
  user_id: string;
  model: string;
  temperature: number;
  max_tokens: number;
  safe_prompt: boolean;
  summarizer_model?: string;
  summarizer_prompt?: string;
  system_prompt?: string;
  updated_at?: string;
}
