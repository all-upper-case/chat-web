import type { Handler } from '@netlify/functions';

const API_URL = 'https://api.mistral.ai/v1/chat/completions';
const DEFAULT_MODEL = 'mistral-small-latest';
const DEFAULT_PROMPT = `You are a highly capable summarization assistant. Read the provided snippet of the ongoing conversation between a user and an assistant, and produce concise summaries of both the user's input and the assistant's response in this format:

[User Summary]
<summary>

[Assistant Summary]
<summary>

Keep essential details (characters, rules/guidance, plot points, instructions), aggressively condense fluff. If multiple topics exist, cover each briefly.`;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return { statusCode: 500, body: 'Server missing MISTRAL_API_KEY' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { transcript = '', model, prompt } = body;
    if (!transcript || typeof transcript !== 'string') {
      return { statusCode: 400, body: 'transcript (string) required' };
    }

    const chosenModel = typeof model === 'string' && model.trim().length > 0 ? model : DEFAULT_MODEL;
    const systemPrompt = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : DEFAULT_PROMPT;

    const payload = {
      model: chosenModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ],
      temperature: 0.2,
      max_tokens: 600
    };

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const txt = await resp.text();
    if (!resp.ok) return { statusCode: resp.status, body: txt };
    const data = JSON.parse(txt);
    const content = data?.choices?.[0]?.message?.content ?? '';

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: content }) };
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
