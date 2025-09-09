import type { Handler } from '@netlify/functions';

const API_URL = 'https://api.mistral.ai/v1/chat/completions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const key = process.env.MISTRAL_API_KEY;
  if (!key) return { statusCode: 500, body: 'Server missing MISTRAL_API_KEY' };

  try {
    const body = JSON.parse(event.body || '{}');

    const {
      messages,
      model = 'mistral-large-latest',
      temperature = 0.7,
      max_tokens = 2048,
      safe_prompt = false
    } = body;

    if (!Array.isArray(messages)) return { statusCode: 400, body: 'messages must be an array' };

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens, safe_prompt })
    });

    const text = await resp.text();
    if (!resp.ok) return { statusCode: resp.status, body: text };

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? '';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, usage: data.usage || {} })
    };
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
