import { z } from 'zod';
export declare const AIResultSchema: z.ZodObject<{
    urgency_level: z.ZodEnum<["critical", "high", "moderate", "low", "minimal"]>;
    protocol_label: z.ZodString;
    confidence: z.ZodNumber;
    red_flags: z.ZodArray<z.ZodString, "many">;
    possible_clusters: z.ZodArray<z.ZodAny, "many">;
    reasoning_summary: z.ZodArray<z.ZodString, "many">;
    suggested_destination: z.ZodString;
    missing_information: z.ZodArray<z.ZodString, "many">;
    handoff_card_markdown: z.ZodString;
    patient_summary: z.ZodString;
    next_steps: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    urgency_level: "critical" | "high" | "moderate" | "low" | "minimal";
    protocol_label: string;
    confidence: number;
    red_flags: string[];
    possible_clusters: any[];
    reasoning_summary: string[];
    suggested_destination: string;
    missing_information: string[];
    handoff_card_markdown: string;
    patient_summary: string;
    next_steps: string[];
}, {
    urgency_level: "critical" | "high" | "moderate" | "low" | "minimal";
    protocol_label: string;
    confidence: number;
    red_flags: string[];
    possible_clusters: any[];
    reasoning_summary: string[];
    suggested_destination: string;
    missing_information: string[];
    handoff_card_markdown: string;
    patient_summary: string;
    next_steps: string[];
}>;
export type AIResult = z.infer<typeof AIResultSchema>;
