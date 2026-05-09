import { NextRequest } from 'next/server';
import { ChatRequestSchema } from '@/lib/schemas';
import { AppError, Errors } from '@/lib/errors';
import { assertTenantExists } from '@/lib/tenants';
import { searchRelevantDocuments } from '@/lib/search';
import { streamChatCompletion } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // 1. Parse y validación del body
    const body: unknown = await req.json().catch(() => null);
    if (!body) {
      return errorResponse(Errors.invalidInput('Body no es JSON válido'));
    }

    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(Errors.invalidInput(parsed.error.flatten()));
    }
    const { question, tenant_id } = parsed.data;

    // 2. Verificar tenant
    await assertTenantExists(tenant_id);

    // 3. Buscar documentos relevantes (RLS aplica)
    const documents = await searchRelevantDocuments(question, tenant_id);
    if (documents.length === 0) {
      return errorResponse(Errors.noRelevantDocuments());
    }

    // 4. Streaming desde Claude
    const textStream = await streamChatCompletion(question, documents);

    // 5. Convertir AsyncIterable a ReadableStream para la Response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of textStream) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (err) {
          // Error durante streaming: lo propagamos como error del stream.
          // El cliente recibirá los chunks que alcanzaron a mandarse + un cierre con error.
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    console.error('Unhandled error in /api/chat:', err);
    return errorResponse(
      Errors.internal(err instanceof Error ? err.message : 'Error desconocido'),
    );
  }
}

function errorResponse(err: AppError): Response {
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.httpStatus,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}