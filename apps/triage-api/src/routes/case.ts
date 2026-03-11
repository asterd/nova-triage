import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { runMedicationLookup, runOrchestrationPipeline, runReportAnalysis } from '../services/agent-orchestrator/pipeline';
import { invokeNovaSonic } from '../services/nova-clients/bedrock';
import { createCaseRecord, getCaseRecord, storeCaseResult, updateCaseStatus, upsertCaseIntake } from '../services/case-store';
import { evaluateSafetyRules } from '../services/agent-orchestrator/safety';

const attachmentSchema = z.object({
    name: z.string(),
    type: z.string(),
    base64: z.string()
});

const analyzeSchema = z.object({
    text: z.string().default(''),
    case_id: z.string().optional(),
    protocol: z.string().default('generic'),
    demographics: z.record(z.string(), z.unknown()).optional(),
    pain_score: z.number().min(0).max(10).optional(),
    onset: z.string().optional(),
    attachments: z.array(attachmentSchema).optional()
});

const reportSchema = z.object({
    text: z.string().default(''),
    language: z.string().default('en'),
    attachments: z.array(attachmentSchema).optional()
});

const medicationSchema = z.object({
    medication_name: z.string().min(1),
    indication: z.string().optional(),
    age_years: z.number().optional(),
    weight_kg: z.number().optional(),
    question: z.string().optional(),
    language: z.string().default('en')
});

export const caseRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.post('/start', async (request, reply) => {
        const record = createCaseRecord('Patient Draft');
        return { case_id: record.case_id, alias: record.alias, created_at: record.created_at };
    });

    server.post('/intake', async (request, reply) => {
        const parsed = analyzeSchema.safeParse(request.body);
        if (!parsed.success || !parsed.data.case_id) {
            return reply.code(400).send({ status: 'error', error: 'Valid case_id and intake payload are required.' });
        }

        const updated = upsertCaseIntake(parsed.data.case_id, {
            text: parsed.data.text,
            attachments_count: parsed.data.attachments?.length || 0,
            setup: parsed.data.demographics
        });

        if (!updated) {
            return reply.code(404).send({ status: 'error', error: 'Case not found.' });
        }

        return { accepted: true, case: updated };
    });

    server.post('/clarify', async (request, reply) => {
        const parsed = analyzeSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ status: 'error', error: 'Invalid clarify payload.' });
        }

        const rules = evaluateSafetyRules({
            rawInput: parsed.data.text,
            normalizedText: parsed.data.text,
            structuredSymptoms: {},
            demographics: parsed.data.demographics || {},
            painScore: parsed.data.pain_score || 0,
            onset: parsed.data.onset || 'unknown'
        });

        return {
            questions: rules.clarification_questions,
            missing_information: rules.missing_information
        };
    });

    server.post<{ Body: { audio_base64: string; sample_rate_hz?: number; format?: string } }>('/voice', async (request, reply) => {
        try {
            const { audio_base64, sample_rate_hz } = request.body;
            const { transcript } = await invokeNovaSonic(
                "You are an expert clinical transcriber. Transcribe the patient's symptoms exactly as spoken. Ignore background noise. Return only the raw text transcript, no surrounding markdown.",
                audio_base64,
                { sampleRateHertz: sample_rate_hz || 16000 }
            );
            return { transcript: transcript.trim() };
        } catch (e: any) {
            server.log.error(e);
            const message = /ENOTFOUND|bedrock-runtime|dns|network/i.test(e.message || '')
                ? 'Bedrock voice transcription endpoint is unreachable. Check AWS region, DNS resolution, and outbound network access.'
                : /nova sonic/i.test(e.message || '')
                ? e.message
                : e.message;
            return reply.code(500).send({ status: 'error', error: message });
        }
    });

    server.post<{ Body: { text: string; case_id: string; protocol: string; demographics?: any; pain_score?: number; onset?: string; attachments?: any[] } }>('/analyze', async (request, reply) => {
        try {
            const parsed = analyzeSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid analyze payload.', details: parsed.error.flatten() });
            }

            const { text, protocol, demographics, pain_score, onset, attachments, case_id } = parsed.data;
            const resolvedCaseId = case_id || createCaseRecord('Patient Draft', demographics).case_id;

            upsertCaseIntake(resolvedCaseId, {
                text,
                attachments_count: attachments?.length || 0,
                setup: demographics
            });
            updateCaseStatus(resolvedCaseId, 'analyzing');

            const result = await runOrchestrationPipeline(
                text,
                protocol || 'generic',
                demographics,
                pain_score || 0,
                onset || 'unknown',
                attachments || []
            );
            storeCaseResult(resolvedCaseId, result);
            return { status: 'completed', case_id: resolvedCaseId, result };
        } catch (e: any) {
            server.log.error(e);
            const parsed = analyzeSchema.safeParse(request.body);
            if (parsed.success && parsed.data.case_id) {
                updateCaseStatus(parsed.data.case_id, 'error', e.message);
            }
            return reply.code(502).send({
                status: 'error',
                source: 'bedrock',
                error: e.message || 'Nova analysis failed.',
                user_message: 'Nova analysis is temporarily unavailable. You can retry or continue the demo with a different scenario.'
            });
        }
    });

    server.post<{ Body: { text: string; language: string; attachments?: any[] } }>('/report-analyze', async (request, reply) => {
        try {
            const parsed = reportSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid report payload.', details: parsed.error.flatten() });
            }

            const { text, language, attachments } = parsed.data;
            const result = await runReportAnalysis(text, language || 'en', attachments || []);
            return { status: 'completed', result };
        } catch (e: any) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });

    server.post<{ Body: { medication_name: string; indication?: string; age_years?: number; weight_kg?: number; question?: string; language: string } }>('/medication-info', async (request, reply) => {
        try {
            const parsed = medicationSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid medication payload.', details: parsed.error.flatten() });
            }

            const result = await runMedicationLookup(parsed.data);
            return { status: 'completed', result };
        } catch (e: any) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });

    server.get('/result/:id', async (request, reply) => {
        const params = z.object({ id: z.string() }).safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ status: 'error', error: 'Invalid case id.' });
        }

        const record = getCaseRecord(params.data.id);
        if (!record) {
            return reply.code(404).send({ status: 'error', error: 'Case not found.' });
        }

        if (!record.latest_result) {
            return reply.send({ status: record.status, case: record });
        }

        return { status: 'completed', case: record, result: record.latest_result };
    });
};
