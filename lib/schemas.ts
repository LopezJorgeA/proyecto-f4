import { z } from 'zod';

export const ChatRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'La pregunta no puede estar vacía')
    .max(1000, 'La pregunta excede el límite de 1000 caracteres'),
  tenant_id: z.string().uuid('tenant_id debe ser un UUID válido'),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  content: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

export type Document = z.infer<typeof DocumentSchema>;