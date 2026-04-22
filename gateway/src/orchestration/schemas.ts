import { z } from 'zod';

/**
 * Zod schemas for validating agent outputs.
 * This ensures the pipeline receives structured and valid data at each stage.
 */

export const CEODraftSchema = z.object({
  vision: z.string(),
  successCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  risks: z.array(z.string()),
  timeline: z.string(),
});

export const PMPlanSchema = z.object({
  userStories: z.array(z.object({
    id: z.string(),
    description: z.string(),
    priority: z.enum(['Must', 'Should', 'Could', 'Wont']),
    acceptanceCriteria: z.array(z.string()),
  })),
  phases: z.array(z.object({
    name: z.string(),
    tasks: z.array(z.string()),
  })),
  dependencies: z.record(z.string(), z.array(z.string())),
});

export const ArchitectureSchema = z.object({
  techStack: z.object({
    frontend: z.string(),
    backend: z.string(),
    database: z.string(),
    other: z.array(z.string()).optional(),
  }),
  components: z.array(z.object({
    name: z.string(),
    responsibilities: z.array(z.string()),
    interfaces: z.array(z.string()),
  })),
  dataFlow: z.string(),
  adrs: z.array(z.object({
    id: z.string(),
    decision: z.string(),
    rationale: z.string(),
  })),
});

export const DBSchemaSchema = z.object({
  tables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string(),
      constraints: z.array(z.string()).optional(),
    })),
  })),
  relationships: z.array(z.string()),
  migrations: z.array(z.string()),
});

export const APIContractSchema = z.object({
  endpoints: z.array(z.object({
    path: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    requestBody: z.unknown().optional(),
    responseBody: z.unknown(),
    authRequired: z.boolean(),
  })),
});

/**
 * Registry mapping agent roles to their output schemas.
 */

// O8 FIX: Base schema for most implementation and review roles
const BaseAgentOutputSchema = z.object({
  summary: z.string(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const UiUxSchema = BaseAgentOutputSchema;
export const BackendSchema = BaseAgentOutputSchema;
export const FrontendSchema = BaseAgentOutputSchema;
export const AuthSchema = BaseAgentOutputSchema;
export const IntegrationSchema = BaseAgentOutputSchema;
export const UnitTestSchema = BaseAgentOutputSchema;
export const IntegrationTestSchema = BaseAgentOutputSchema;
export const SecuritySchema = z.object({
  summary: z.string(),
  vulnerabilities: z.array(z.object({
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    title: z.string(),
    description: z.string(),
    recommendation: z.string(),
  })).optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const PerformanceSchema = z.object({
  summary: z.string(),
  metrics: z.array(z.object({
    name: z.string(),
    value: z.string(),
    unit: z.string().optional(),
    status: z.enum(['good', 'warning', 'critical']).optional(),
  })).optional(),
  bottlenecks: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const CodeReviewSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'info']),
    file: z.string(),
    line: z.union([z.number(), z.string()]).optional(),
    message: z.string(),
    suggestion: z.string().optional(),
  })).optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const DocsSchema = z.object({
  summary: z.string(),
  sections: z.array(z.string()).optional(),
  apisDocumented: z.array(z.string()).optional(),
  coverage: z.string().optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const TechWriterSchema = z.object({
  summary: z.string(),
  changes: z.array(z.string()).optional(),
  breakingChanges: z.array(z.string()).optional(),
  version: z.string().optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const DevopsSchema = z.object({
  summary: z.string(),
  deploymentTarget: z.string().optional(),
  steps: z.array(z.object({
    order: z.number(),
    action: z.string(),
    command: z.string().optional(),
    expected: z.string().optional(),
  })).optional(),
  environmentVars: z.array(z.string()).optional(),
  rollbackPlan: z.string().optional(),
  filesCreated: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
});

export const AGENT_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  ceo: CEODraftSchema,
  pm: PMPlanSchema,
  architect: ArchitectureSchema,
  database: DBSchemaSchema,
  api_designer: APIContractSchema,
  ui_ux: UiUxSchema,
  backend: BackendSchema,
  frontend: FrontendSchema,
  auth: AuthSchema,
  integration: IntegrationSchema,
  unit_test: UnitTestSchema,
  integration_test: IntegrationTestSchema,
  security: SecuritySchema,
  performance: PerformanceSchema,
  code_review: CodeReviewSchema,
  docs: DocsSchema,
  tech_writer: TechWriterSchema,
  devops: DevopsSchema,
};

export type APIContract = z.infer<typeof APIContractSchema>;
export type Architecture = z.infer<typeof ArchitectureSchema>;
export type PMPlan = z.infer<typeof PMPlanSchema>;
export type CEODraft = z.infer<typeof CEODraftSchema>;
export type SecurityAudit = z.infer<typeof SecuritySchema>;
export type PerformanceReport = z.infer<typeof PerformanceSchema>;
export type CodeReview = z.infer<typeof CodeReviewSchema>;
export type Docs = z.infer<typeof DocsSchema>;
export type TechWriter = z.infer<typeof TechWriterSchema>;
export type Devops = z.infer<typeof DevopsSchema>;

/**
 * Safely validate agent output without throwing.
 * Returns { success, data, errors } object.
 */
export function safeValidate(
  role: string,
  data: unknown
): { success: boolean; data?: unknown; errors?: string[] } {
  const schema = AGENT_SCHEMAS[role];
  if (!schema) {
    return { success: true, data };
  }
  try {
    const parsed = schema.parse(data);
    return { success: true, data: parsed };
  } catch (err) {
    const zodErr = err as { errors?: Array<{ path?: string[]; message?: string }>; message?: string };
    const errors = zodErr?.errors?.map((e) =>
      `${e.path?.join('.') ?? 'root'}: ${e.message ?? String(e)}`
    ) ?? [zodErr?.message ?? 'Unknown validation error'];
    return { success: false, errors };
  }
}

/**
 * Get detailed validation error messages for agent output.
 */
export function getValidationErrors(role: string, data: unknown): string[] {
  const result = safeValidate(role, data);
  return result.success ? [] : result.errors ?? [];
}

/**
 * Extract JSON from raw LLM text output and validate against agent schema.
 * Handles ```json code blocks and raw JSON objects.
 */
export function sanitizeOutput(
  role: string,
  rawText: string
): { success: boolean; data?: unknown; errors?: string[] } {
  const schema = AGENT_SCHEMAS[role];
  if (!schema) {
    return { success: true, data: rawText };
  }

  // Try extracting JSON from code blocks first
  const codeBlockMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]!);
      return safeValidate(role, parsed);
    } catch {
      // Fall through to raw JSON extraction
    }
  }

  // Try finding raw JSON object
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]!);
      return safeValidate(role, parsed);
    } catch {
      // Fall through
    }
  }

  return {
    success: false,
    errors: [`Could not extract valid JSON from ${role} output`],
  };
}
