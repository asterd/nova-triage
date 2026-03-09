"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIResultSchema = void 0;
const zod_1 = require("zod");
exports.AIResultSchema = zod_1.z.object({
    urgency_level: zod_1.z.enum(['critical', 'high', 'moderate', 'low', 'minimal']),
    protocol_code: zod_1.z.string().optional(),
    protocol_label: zod_1.z.string(),
    confidence: zod_1.z.number(),
    red_flags: zod_1.z.array(zod_1.z.string()),
    rules_triggered: zod_1.z.array(zod_1.z.string()).default([]),
    safety_escalation_applied: zod_1.z.boolean().default(false),
    deterministic_notes: zod_1.z.array(zod_1.z.string()).default([]),
    possible_clusters: zod_1.z.array(zod_1.z.any()),
    reasoning_summary: zod_1.z.array(zod_1.z.string()),
    suggested_destination_code: zod_1.z.string().optional(),
    suggested_destination: zod_1.z.string(),
    missing_information: zod_1.z.array(zod_1.z.string()),
    clarification_questions: zod_1.z.array(zod_1.z.string()).default([]),
    audit_trail: zod_1.z.array(zod_1.z.object({
        step: zod_1.z.string(),
        status: zod_1.z.enum(['completed', 'fallback', 'failed', 'skipped']),
        summary: zod_1.z.string()
    })).default([]),
    handoff_card_markdown: zod_1.z.string(),
    patient_summary: zod_1.z.string(),
    next_steps: zod_1.z.array(zod_1.z.string())
});
