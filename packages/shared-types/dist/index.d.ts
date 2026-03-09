import { z } from 'zod';
export declare const AIResultSchema: z.ZodObject<{
    urgency_level: z.ZodEnum<["critical", "high", "moderate", "low", "minimal"]>;
    protocol_code: z.ZodOptional<z.ZodString>;
    protocol_label: z.ZodString;
    confidence: z.ZodNumber;
    red_flags: z.ZodArray<z.ZodString, "many">;
    rules_triggered: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    safety_escalation_applied: z.ZodDefault<z.ZodBoolean>;
    deterministic_notes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    possible_clusters: z.ZodArray<z.ZodAny, "many">;
    reasoning_summary: z.ZodArray<z.ZodString, "many">;
    suggested_destination_code: z.ZodOptional<z.ZodString>;
    suggested_destination: z.ZodString;
    missing_information: z.ZodArray<z.ZodString, "many">;
    clarification_questions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    audit_trail: z.ZodDefault<z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        status: z.ZodEnum<["completed", "fallback", "failed", "skipped"]>;
        summary: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: "completed" | "fallback" | "failed" | "skipped";
        step: string;
        summary: string;
    }, {
        status: "completed" | "fallback" | "failed" | "skipped";
        step: string;
        summary: string;
    }>, "many">>;
    handoff_card_markdown: z.ZodString;
    patient_summary: z.ZodString;
    next_steps: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    urgency_level: "critical" | "high" | "moderate" | "low" | "minimal";
    protocol_label: string;
    confidence: number;
    red_flags: string[];
    rules_triggered: string[];
    safety_escalation_applied: boolean;
    deterministic_notes: string[];
    possible_clusters: any[];
    reasoning_summary: string[];
    suggested_destination: string;
    missing_information: string[];
    clarification_questions: string[];
    audit_trail: {
        status: "completed" | "fallback" | "failed" | "skipped";
        step: string;
        summary: string;
    }[];
    handoff_card_markdown: string;
    patient_summary: string;
    next_steps: string[];
    protocol_code?: string | undefined;
    suggested_destination_code?: string | undefined;
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
    protocol_code?: string | undefined;
    rules_triggered?: string[] | undefined;
    safety_escalation_applied?: boolean | undefined;
    deterministic_notes?: string[] | undefined;
    suggested_destination_code?: string | undefined;
    clarification_questions?: string[] | undefined;
    audit_trail?: {
        status: "completed" | "fallback" | "failed" | "skipped";
        step: string;
        summary: string;
    }[] | undefined;
}>;
export type AIResult = z.infer<typeof AIResultSchema>;
