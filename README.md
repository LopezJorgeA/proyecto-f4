# Mini Chat RAG Multi-tenant

Endpoint backend en Next.js 14 que permite a usuarios de diferentes empresas (tenants) hacer preguntas en lenguaje natural sobre sus propios documentos. Cada empresa solo puede consultar su propia información, garantizado por Row-Level Security de Postgres con defense-in-depth.

Incluye una interfaz web mínima para validación visual e implementación de streaming en tiempo real.

## Stack

- **Next.js 14** (App Router) + **TypeScript estricto**
- **Supabase** (Postgres con RLS)
- **Anthropic Claude Haiku 4.5** con streaming
- **Zod** para validación de schemas
- **Tailwind CSS** para el frontend
- **Búsqueda fulltext** de Postgres con `tsvector` + `ts_rank`

## Setup local

### Requisitos previos

- Node.js 20+
- Cuenta de Supabase (plan free es suficiente)
- API key de Anthropic

### 1. Clonar e instalar

```bash
git clone <url-del-repo>
cd <directorio>
npm install
```

### 2. Configurar Supabase

1. Crear un proyecto nuevo en [supabase.com](https://supabase.com).
2. En el SQL Editor, ejecutar las migraciones en orden:
   - `supabase/migrations/001_init.sql` — tablas, índices, RLS y policies
   - `supabase/migrations/002_rpc.sql` — función auxiliar `set_tenant_context`
   - `supabase/migrations/003_search.sql` — RPC unificado `search_tenant_documents`
3. Copiar las credenciales del proyecto (Project URL, anon key, service_role key) desde Settings → API.

### 3. Variables de entorno

```bash
cp .env.example .env.local
```

Llenar `.env.local` con las credenciales:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Cargar datos de ejemplo

```bash
npm run seed
```

Crea 2 tenants ("Empresa A" y "Empresa B") con 5 documentos cada uno. Anota los UUIDs que imprime; los necesitas para probar el endpoint manualmente. **Importante:** si el frontend está hardcodeado con UUIDs específicos, actualízalos en `app/page.tsx` para que coincidan con los que devuelve tu seed.

### 5. Validar aislamiento

```bash
npm run test:isolation
```

Ejecuta 5 asserts que verifican el aislamiento de tenants directamente contra la base de datos (sin pasar por el endpoint HTTP). Debe imprimir `5/5 tests pasaron`.

### 6. Levantar el servidor

```bash
npm run dev
```

- Endpoint disponible en `http://localhost:3000/api/chat`
- Interfaz web en `http://localhost:3000`

## Uso del endpoint

### Request

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Cuál es la política de devoluciones?",
    "tenant_id": "<uuid-del-tenant>"
  }'
```

### Response

| Status | Código | Descripción |
|---|---|---|
| 200 | (stream) | Respuesta de Claude streameada como `text/plain` |
| 400 | INVALID_INPUT | Body inválido o falla de validación Zod |
| 404 | TENANT_NOT_FOUND | El `tenant_id` no existe |
| 404 | NO_RELEVANT_DOCUMENTS | No se encontraron documentos relevantes |
| 429 | CLAUDE_RATE_LIMIT | Rate limit alcanzado en Claude API |
| 502 | CLAUDE_API_ERROR | Error genérico de Claude API |
| 504 | CLAUDE_TIMEOUT | Timeout en Claude API |
| 500 | DATABASE_ERROR | Error de base de datos |
| 500 | INTERNAL_ERROR | Error inesperado |

Todos los errores devuelven JSON con la forma:

```json
{
  "error": {
    "code": "TENANT_NOT_FOUND",
    "message": "Tenant ... no existe",
    "details": { }
  }
}
```

## Arquitectura

```
┌─────────────────────┐
│  Cliente (web/curl) │
└──────────┬──────────┘
           │ POST /api/chat
           ▼
┌─────────────────────────────────────────┐
│  app/api/chat/route.ts                  │
│  ┌──────────────────────────────────┐   │
│  │ 1. Validación Zod (body)         │   │
│  │ 2. Verificación tenant existe    │   │
│  │ 3. Búsqueda fulltext con RLS     │   │
│  │ 4. Streaming Claude              │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
           │
           ├──► Supabase (RPC search_tenant_documents)
           │    ├─ Defense-in-depth: filtro explícito tenant_id
           │    └─ RLS: policy con current_setting('request.tenant_id')
           │
           └──► Anthropic API (messages.stream)
                └─ Claude Haiku 4.5
```

## Decisiones técnicas

### 1. RPC unificado para garantizar aislamiento RLS

**Decisión:** consolidar `set_tenant_context` y la búsqueda fulltext en un único RPC `search_tenant_documents` que ejecuta ambas operaciones en la misma transacción de Postgres.

**Por qué:** PostgREST envuelve cada request HTTP en su propia transacción. Como `set_config(..., true)` es local a la transacción, hacer dos llamadas RPC separadas (una para setear el GUC, otra para buscar) resulta en que el GUC se pierde antes de la búsqueda y la RLS policy retorna 0 filas. Consolidar en un solo RPC garantiza que ambas operaciones ocurran en la misma transacción.

**Tradeoff:** la función necesita `SECURITY DEFINER` para que el rol anon pueda invocar `set_config`. Esto se compensa con el filtro explícito de `tenant_id` que actúa como segunda barrera.

### 2. Defense-in-depth en el aislamiento

**Decisión:** dentro del RPC, filtrar explícitamente por `tenant_id` además de depender de la RLS policy:

```sql
where d.tenant_id::text = p_tenant_id
  and to_tsvector('spanish', d.content) @@ ts_query
```

**Por qué:** si la RLS policy fuera removida, alterada o desactivada temporalmente para debuggear, el filtro explícito mantendría el aislamiento. Es una práctica recomendada en sistemas multi-tenant donde el costo de un leak es mucho mayor que el costo de la redundancia.

### 3. Búsqueda fulltext con OR en lugar de AND

**Decisión:** convertir el `tsquery` resultante de `websearch_to_tsquery` reemplazando los operadores `&` por `|`.

**Por qué:** el diccionario `'spanish'` de Postgres no incluye palabras interrogativas con tilde como `cuál` o `qué` en su lista de stop words. Con AND-based search, una pregunta como "¿Cuál es la política de devoluciones?" genera el tsquery `'cual' & 'polit' & 'devolu'`, y como ningún documento contiene la raíz de `cuál`, el match falla. Con OR, `ts_rank` ordena los resultados por relevancia y los documentos con más términos matcheados aparecen primero.

**Diagnóstico:** este bug se descubrió validando con queries SQL directas (`select to_tsvector(...) @@ websearch_to_tsquery(...)`), comparando los lexemas generados por la pregunta vs los del documento.

**Tradeoff:** se sacrifica precisión por recall. En RAG esto es preferible: Claude puede ignorar contexto irrelevante, pero no puede inventar contexto faltante. Con embeddings semánticos (pgvector) este problema desaparece.

### 4. Streaming con text/plain en lugar de SSE

**Decisión:** retornar el stream con `Content-Type: text/plain; charset=utf-8`.

**Por qué:** el brief permite "SSE o stream nativo de Next.js". text/plain es más simple para el cliente (no requiere parser de SSE) y compatible con cualquier consumidor que use `response.body.getReader()`. Para escalar a múltiples eventos tipados (deltas, citas, metadata) sí valdría la pena migrar a SSE.

### 5. Validación Zod en runtime para resultados de DB

**Decisión:** validar los resultados de la query de Supabase con `DocumentSchema.parse(row)` en runtime, en lugar de hacer cast directo con `as Document[]`.

**Por qué:** detecta drift de schema en tiempo real. Si en el futuro se agrega o modifica una columna de `documents`, el error se levanta en la línea exacta de la búsqueda en lugar de propagar datos malformados a Claude.

### 6. Modelo Claude Haiku 4.5

**Decisión:** usar `claude-haiku-4-5-20251001` como modelo principal.

**Por qué:** para RAG con contextos cortos (máximo 5 docs de ~200 caracteres), Haiku ofrece calidad adecuada a fracción del costo y latencia de Sonnet. Cambiar a Sonnet es trivial: una constante en `lib/anthropic.ts`.

### 7. tenant_id en body en lugar de JWT

**Decisión:** recibir `tenant_id` en el body de la request en lugar de extraerlo de un JWT.

**Por qué:** el brief lo permite explícitamente y reduce significativamente el scope. Implementar Supabase Auth con custom claims y validación de JWT en cada request añadiría 1.5–2 horas sin aportar valor diferencial al ejercicio.

**Tradeoff:** un cliente puede mandar cualquier `tenant_id` si conoce el UUID. En producción real, el `tenant_id` vendría como custom claim del JWT firmado por Supabase Auth, y la policy de RLS lo leería con `auth.jwt() ->> 'tenant_id'`. La arquitectura actual permite esa migración sin tocar el resto del flujo.

### 8. Carga de envs con --env-file en scripts standalone

**Decisión:** los scripts `seed` y `test:isolation` usan `tsx --env-file=.env.local` en lugar de `dotenv.config()` dentro del script.

**Por qué:** `lib/supabase/admin.ts` valida las envs a nivel de módulo (crash-fast en startup, comportamiento deseado para Next.js). Los scripts standalone que importan `admin.ts` ejecutan esa validación durante la resolución de imports, antes de que `dotenv.config()` corra dentro del cuerpo del script. `--env-file` carga las variables antes de procesar imports, resolviendo ambos casos.

## Limitaciones reconocidas

### Lo que no implementé y por qué

- **pgvector + embeddings:** prioricé entregar 100% completo sobre incluir el bonus. La búsqueda fulltext con OR + ranking funciona correctamente para los seeds actuales. Para queries semánticamente más complejas (sinónimos, paráfrasis), embeddings serían superiores.
- **Autenticación con JWT:** ver decisión #7.
- **Rate limiting:** el endpoint está abierto. En producción agregaría rate limiting por tenant para evitar abuso del API key de Anthropic.
- **Tests automatizados de la integración HTTP:** solo hay test de aislamiento a nivel DB. Tests del endpoint completo con mocks del SDK de Anthropic serían el siguiente paso.
- **Observabilidad estructurada:** solo `console.error` en errores no controlados. En producción usaría logger estructurado (pino) y APM (Sentry, Datadog).
- **Dockerización y CI/CD:** fuera de scope para 6-7 horas.

### Qué haría diferente con más tiempo

- Migrar a pgvector con embeddings de Voyage AI o OpenAI text-embedding-3-small.
- Implementar JWT auth con custom claim `tenant_id`, ajustar RLS para leerlo desde `auth.jwt()`.
- Agregar prompt caching de Anthropic en el system prompt (los documentos cambian poco).
- Cachear respuestas frecuentes con Redis.
- Tests del endpoint con MSW (mock de Anthropic API) y supertest.
- Migrar streaming a SSE para soportar múltiples eventos tipados.

### Para producción con 1000 usuarios concurrentes

- Pool de conexiones de Supabase más grande (free tier es limitado).
- Rate limiting por tenant con Upstash Redis.
- Queue de requests con retry y backoff exponencial.
- Caché de embeddings y de respuestas frecuentes.
- Streaming con SSE y múltiples eventos tipados (deltas, citas, metadata).
- Observabilidad con tracing distribuido (OpenTelemetry).
- Prompt caching de Anthropic para reducir costo y latencia.

## Estructura del proyecto

```
.
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # Endpoint POST /api/chat
│   ├── layout.tsx                # Layout global (dark mode)
│   ├── page.tsx                  # Frontend con UI de chat
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── server.ts             # Cliente anon (RLS aplica)
│   │   └── admin.ts              # Cliente service role (solo seed/admin)
│   ├── anthropic.ts              # Integración Claude con streaming
│   ├── errors.ts                 # AppError + factories tipados
│   ├── schemas.ts                # Schemas Zod
│   ├── search.ts                 # Búsqueda fulltext con RLS
│   └── tenants.ts                # Verificación de existencia de tenants
├── supabase/
│   ├── migrations/
│   │   ├── 001_init.sql          # Schema, índices, RLS, policies
│   │   ├── 002_rpc.sql           # set_tenant_context (referencia)
│   │   └── 003_search.sql        # search_tenant_documents (RPC unificado)
│   └── seed.ts                   # Datos de ejemplo
├── tests/
│   └── tenant-isolation.test.ts  # Test de aislamiento a nivel DB
├── .env.example
├── package.json
├── README.md
└── tsconfig.json
```

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Levanta el servidor de desarrollo en localhost:3000 |
| `npm run build` | Build de producción |
| `npm run start` | Servidor de producción |
| `npm run lint` | ESLint |
| `npm run seed` | Carga 2 tenants y 10 documentos en Supabase |
| `npm run test:isolation` | Ejecuta el test de aislamiento de tenants |