import type { Handler } from '@netlify/functions';

const API_URL = 'https://api.mistral.ai/v1/chat/completions';
const SUMMARIZER_MODEL = 'mistral-small-latest';

const SYSTEM = `You are a concise conversation summarizer.
Summarize the prior turns faithfully. Keep facts and decisions. Omit fluff.
Return a single paragraph (5–10 sentences).`;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return { statusCode: 500, body: 'Server missing MISTRAL_API_KEY' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { transcript = '' } = body;
    if (!transcript || typeof transcript !== 'string') {
      return { statusCode: 400, body: 'transcript (string) required' };
    }

    const payload = {
      model: SUMMARIZER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
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
