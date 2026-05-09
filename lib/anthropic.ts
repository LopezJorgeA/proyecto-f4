import Anthropic from '@anthropic-ai/sdk';
import { Errors } from './errors';
import type { Document } from './schemas';

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error('Missing ANTHROPIC_API_KEY');
}

const client = new Anthropic({ apiKey });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

function buildSystemPrompt(documents: Document[]): string {
  const context = documents
    .map((doc, idx) => `[Documento ${idx + 1}]\n${doc.content}`)
    .join('\n\n');

  return `Eres un asistente que responde preguntas de usuarios de una empresa basándote ÚNICAMENTE en los documentos de contexto proporcionados.

Reglas:
- Responde en español, de forma clara y concisa.
- Si la respuesta no está en los documentos, indica que no tienes esa información.
- No inventes datos que no estén explícitamente en los documentos.
- Cita el documento del que sacaste la información cuando sea relevante.

Documentos de contexto:

${context}`;
}

export async function streamChatCompletion(
  question: string,
  documents: Document[],
): Promise<AsyncIterable<string>> {
  try {
    const stream = await client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(documents),
        messages: [{ role: 'user', content: question }],
      },
      { timeout: TIMEOUT_MS },
    );

    return mapStreamToText(stream);
  } catch (err) {
    throw mapAnthropicError(err);
  }
}

async function* mapStreamToText(
  stream: Awaited<ReturnType<typeof client.messages.stream>>,
): AsyncGenerator<string> {
  try {
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  } catch (err) {
    throw mapAnthropicError(err);
  }
}

function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return Errors.claudeRateLimit();
    if (err.status === 408 || err.status === 504) return Errors.claudeTimeout();
    return Errors.claudeApiError(err.message);
  }

  if (err instanceof Error && err.name === 'AbortError') {
    return Errors.claudeTimeout();
  }

  return Errors.claudeApiError(
    err instanceof Error ? err.message : 'Error desconocido',
  );
}