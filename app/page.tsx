'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type Tenant = { id: string; name: string; emoji: string };
type ApiError = { code: string; message: string };
type ApiErrorPayload = { error: ApiError };

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_A: Tenant = {
  id: '2929e880-f7e3-4d12-adf8-34da1807234b',
  name: 'Empresa A',
  emoji: '🏢',
};
const TENANT_B: Tenant = {
  id: '72743cfc-7f09-4464-bade-fbc2c80b8f8f',
  name: 'Empresa B',
  emoji: '🏬',
};
const TENANTS: Tenant[] = [TENANT_A, TENANT_B];

const QUICK_QUESTIONS: string[] = [
  '¿Cuál es la política de devoluciones?',
  '¿Cuál es el horario de atención?',
  '¿Qué métodos de pago aceptan?',
  '¿Cómo funciona el envío?',
  '¿Qué planetas hay en el sistema solar?',
];

const MAX_QUESTION_LENGTH = 1000;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT:
    'Tu pregunta no es válida. Revisa que no esté vacía y tenga menos de 1000 caracteres.',
  TENANT_NOT_FOUND: 'El tenant seleccionado no existe en la base de datos.',
  NO_RELEVANT_DOCUMENTS:
    'No se encontraron documentos relevantes para esta pregunta. Intenta reformularla.',
  CLAUDE_RATE_LIMIT:
    'Hemos alcanzado el límite de la API de Claude. Intenta en unos segundos.',
  CLAUDE_TIMEOUT: 'La API de Claude tardó demasiado en responder.',
  CLAUDE_API_ERROR: 'Error en la API de Claude.',
  DATABASE_ERROR: 'Error en la base de datos.',
  INTERNAL_ERROR: 'Error interno del servidor.',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateUuid(uuid: string): string {
  return `${uuid.slice(0, 8)}...${uuid.slice(-4)}`;
}

function getErrorMessage(code: string, fallback: string): string {
  return ERROR_MESSAGES[code] ?? fallback;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(TENANT_A);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [responseTenant, setResponseTenant] = useState<Tenant | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    setIsStreaming(false);
    setResponse('');
  };

  const handleSubmit = useCallback(async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading || question.length > MAX_QUESTION_LENGTH) return;

    // Cancel any previous in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setIsStreaming(false);
    setResponse('');
    setError(null);
    setResponseTenant(selectedTenant);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion, tenant_id: selectedTenant.id }),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';

      // Errors come back as JSON regardless of status code
      if (!res.ok || contentType.includes('application/json')) {
        const payload = (await res.json()) as ApiErrorPayload;
        setError(payload.error);
        setResponseTenant(null);
        return;
      }

      // ── Streaming path ──────────────────────────────────────────────────
      const reader = res.body?.getReader();
      if (!reader) {
        setError({
          code: 'INTERNAL_ERROR',
          message: 'No se pudo leer el stream de respuesta.',
        });
        setResponseTenant(null);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = '';
      setIsStreaming(true);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setResponse(accumulated);
        }
        // Clear input only after a fully successful stream
        setQuestion('');
      } finally {
        setIsStreaming(false);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error desconocido',
      });
      setResponseTenant(null);
    } finally {
      setIsLoading(false);
    }
  }, [question, isLoading, selectedTenant]);

  const isOverLimit = question.length > MAX_QUESTION_LENGTH;
  const canSubmit = question.trim().length > 0 && !isLoading && !isOverLimit;
  const hasOutput = response.length > 0 || error !== null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <header className="text-center pt-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2">
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Mini Chat RAG
            </span>
          </h1>
          <p className="text-zinc-400 text-base md:text-lg mb-3">
            Multi-tenant document Q&amp;A con aislamiento RLS
          </p>
          <span className="inline-block px-3 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium">
            Powered by Claude Haiku 4.5
          </span>
        </header>

        {/* ── Tenant selector ───────────────────────────────────────────── */}
        <section aria-labelledby="tenant-heading">
          <p
            id="tenant-heading"
            className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3"
          >
            Selecciona el tenant
          </p>
          <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="tenant-heading">
            {TENANTS.map((tenant) => {
              const isSelected = selectedTenant.id === tenant.id;
              return (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => setSelectedTenant(tenant)}
                  aria-pressed={isSelected}
                  className={[
                    'flex flex-col items-start gap-1 p-4 rounded-xl border text-left',
                    'transition-all duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                    'focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                    isSelected
                      ? 'border-violet-500 bg-violet-500/10 text-zinc-100'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/60',
                  ].join(' ')}
                >
                  <span className="text-2xl" role="img" aria-label={tenant.name}>
                    {tenant.emoji}
                  </span>
                  <span className="font-semibold text-sm">{tenant.name}</span>
                  <span className="text-xs font-mono opacity-60">{truncateUuid(tenant.id)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Quick questions ───────────────────────────────────────────── */}
        <section aria-labelledby="quick-heading">
          <p
            id="quick-heading"
            className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3"
          >
            Pruebas rápidas
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuestion(q);
                  textareaRef.current?.focus();
                }}
                disabled={isLoading}
                className={[
                  'px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-800',
                  'text-sm text-zinc-300 transition-colors duration-150',
                  'hover:bg-zinc-700 hover:border-zinc-600 hover:text-zinc-100',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                ].join(' ')}
              >
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* ── Input area ────────────────────────────────────────────────── */}
        <section>
          <label
            htmlFor="question-input"
            className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3"
          >
            Pregunta
          </label>
          <div className="relative">
            <textarea
              ref={textareaRef}
              id="question-input"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              disabled={isLoading}
              placeholder="Escribe tu pregunta sobre los documentos del tenant seleccionado..."
              aria-describedby="char-counter"
              className={[
                'w-full resize-none rounded-xl px-4 py-3 pr-28 text-base',
                'bg-zinc-900 text-zinc-100 placeholder-zinc-500',
                'border transition-colors duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isOverLimit
                  ? 'border-red-500'
                  : 'border-zinc-700 focus:border-violet-500',
              ].join(' ')}
            />
            <span
              id="char-counter"
              aria-live="polite"
              aria-atomic="true"
              className={[
                'absolute bottom-3 right-3 text-xs font-mono pointer-events-none select-none',
                isOverLimit ? 'text-red-400' : 'text-zinc-500',
              ].join(' ')}
            >
              {question.length}&thinsp;/&thinsp;{MAX_QUESTION_LENGTH}
            </span>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-zinc-600">
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono text-xs">
                ⌘
              </kbd>
              {' + '}
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono text-xs">
                Enter
              </kbd>
              {' para enviar'}
            </p>
            <div className="flex items-center gap-2">
              {isLoading && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className={[
                    'px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-900',
                    'text-sm font-semibold text-zinc-300',
                    'hover:bg-zinc-800 hover:border-zinc-600 transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                  ].join(' ')}
                >
                  Cancelar
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                aria-busy={isLoading}
                className={[
                  'flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold',
                  'transition-all duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                  'focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                  canSubmit
                    ? 'bg-violet-600 hover:bg-violet-700 text-white'
                    : 'bg-zinc-700 text-zinc-400 cursor-not-allowed opacity-50',
                ].join(' ')}
              >
                {isLoading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Generando...
                  </>
                ) : (
                  'Preguntar'
                )}
              </button>
            </div>
          </div>
        </section>

        {/* ── Response area ─────────────────────────────────────────────── */}
        {hasOutput && (
          <section aria-label="Respuesta" aria-live="polite">
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  {!error && responseTenant ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400">
                      {responseTenant.emoji} Respuesta de {responseTenant.name}
                    </span>
                  ) : error ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
                      Error: {error.code}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResponse('');
                    setError(null);
                    setResponseTenant(null);
                  }}
                  aria-label="Limpiar respuesta"
                  className={[
                    'shrink-0 text-zinc-600 hover:text-zinc-400 text-sm transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded px-1',
                  ].join(' ')}
                >
                  ✕ Limpiar
                </button>
              </div>

              {error ? (
                <p className="text-zinc-300 text-sm leading-relaxed">
                  {getErrorMessage(error.code, error.message)}
                </p>
              ) : (
                <div className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {response}
                  {isStreaming && (
                    <span
                      className="inline-block w-0.5 h-[1em] bg-violet-400 animate-pulse ml-0.5 align-text-bottom"
                      aria-hidden="true"
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="text-center pb-4">
          <p className="text-zinc-700 text-xs leading-relaxed">
            Aislamiento garantizado por Row-Level Security de Postgres
            {' • '}
            Defense-in-depth con filtro explícito de tenant_id
          </p>
        </footer>

      </div>
    </div>
  );
}
