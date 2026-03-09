import { z } from 'zod';

export const AIResultSchema = z.object({
    urgency_level: z.enum(['critical', 'high', 'moderate', 'low', 'minimal']),
    protocol_label: z.string(),
    confidence: z.number(),
    red_flags: z.array(z.string()),
    possible_clusters: z.array(z.any()),
    reasoning_summary: z.array(z.string()),
    suggested_destination: z.string(),
    missing_information: z.array(z.string()),
    handoff_card_markdown: z.string(),
    patient_summary: z.string(),
    next_steps: z.array(z.string())
});

export type AIResult = z.infer<typeof AIResultSchema>;
