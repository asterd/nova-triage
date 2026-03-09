"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIResultSchema = void 0;
const zod_1 = require("zod");
exports.AIResultSchema = zod_1.z.object({
    urgency_level: zod_1.z.enum(['critical', 'high', 'moderate', 'low', 'minimal']),
    protocol_label: zod_1.z.string(),
    confidence: zod_1.z.number(),
    red_flags: zod_1.z.array(zod_1.z.string()),
    possible_clusters: zod_1.z.array(zod_1.z.any()),
    reasoning_summary: zod_1.z.array(zod_1.z.string()),
    suggested_destination: zod_1.z.string(),
    missing_information: zod_1.z.array(zod_1.z.string()),
    handoff_card_markdown: zod_1.z.string(),
    patient_summary: zod_1.z.string(),
    next_steps: zod_1.z.array(zod_1.z.string())
});
