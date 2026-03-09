import { z } from 'zod';

export const AIResultSchema = z.object({
    urgency_level: z.enum(['critical', 'high', 'moderate', 'low', 'minimal']),
    protocol_code: z.string().optional(),
    protocol_label: z.string(),
    confidence: z.number(),
    red_flags: z.array(z.string()),
    rules_triggered: z.array(z.string()).default([]),
    safety_escalation_applied: z.boolean().default(false),
    deterministic_notes: z.array(z.string()).default([]),
    possible_clusters: z.array(z.any()),
    reasoning_summary: z.array(z.string()),
    suggested_destination_code: z.string().optional(),
    suggested_destination: z.string(),
    missing_information: z.array(z.string()),
    clarification_questions: z.array(z.string()).default([]),
    audit_trail: z.array(z.object({
        step: z.string(),
        status: z.enum(['completed', 'fallback', 'failed', 'skipped']),
        summary: z.string()
    })).default([]),
    handoff_card_markdown: z.string(),
    patient_summary: z.string(),
    next_steps: z.array(z.string())
});

export type AIResult = z.infer<typeof AIResultSchema>;
