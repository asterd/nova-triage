"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.caseRoutes = void 0;
const zod_1 = require("zod");
const pipeline_1 = require("../services/agent-orchestrator/pipeline");
const bedrock_1 = require("../services/nova-clients/bedrock");
const case_store_1 = require("../services/case-store");
const safety_1 = require("../services/agent-orchestrator/safety");
const attachmentSchema = zod_1.z.object({
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    base64: zod_1.z.string()
});
const analyzeSchema = zod_1.z.object({
    text: zod_1.z.string().default(''),
    case_id: zod_1.z.string().optional(),
    protocol: zod_1.z.string().default('generic'),
    demographics: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    pain_score: zod_1.z.number().min(0).max(10).optional(),
    onset: zod_1.z.string().optional(),
    attachments: zod_1.z.array(attachmentSchema).optional()
});
const reportSchema = zod_1.z.object({
    text: zod_1.z.string().default(''),
    language: zod_1.z.string().default('en'),
    attachments: zod_1.z.array(attachmentSchema).optional()
});
const medicationSchema = zod_1.z.object({
    medication_name: zod_1.z.string().min(1),
    indication: zod_1.z.string().optional(),
    age_years: zod_1.z.number().optional(),
    weight_kg: zod_1.z.number().optional(),
    question: zod_1.z.string().optional(),
    language: zod_1.z.string().default('en')
});
const caseRoutes = async (server) => {
    server.post('/start', async (request, reply) => {
        const record = (0, case_store_1.createCaseRecord)('Patient Draft');
        return { case_id: record.case_id, alias: record.alias, created_at: record.created_at };
    });
    server.post('/intake', async (request, reply) => {
        const parsed = analyzeSchema.safeParse(request.body);
        if (!parsed.success || !parsed.data.case_id) {
            return reply.code(400).send({ status: 'error', error: 'Valid case_id and intake payload are required.' });
        }
        const updated = (0, case_store_1.upsertCaseIntake)(parsed.data.case_id, {
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
        const rules = (0, safety_1.evaluateSafetyRules)({
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
    server.post('/voice', async (request, reply) => {
        try {
            const { audio_base64, sample_rate_hz } = request.body;
            const transcript = await (0, bedrock_1.invokeNovaSonic)("You are an expert clinical transcriber. Transcribe the patient's symptoms exactly as spoken. Ignore background noise. Return only the raw text transcript, no surrounding markdown.", audio_base64, { sampleRateHertz: sample_rate_hz || 16000 });
            return { transcript: transcript.trim() };
        }
        catch (e) {
            server.log.error(e);
            const message = /ENOTFOUND|bedrock-runtime|dns|network/i.test(e.message || '')
                ? 'Bedrock voice transcription endpoint is unreachable. Check AWS region, DNS resolution, and outbound network access.'
                : /nova sonic/i.test(e.message || '')
                    ? e.message
                    : e.message;
            return reply.code(500).send({ status: 'error', error: message });
        }
    });
    server.post('/analyze', async (request, reply) => {
        try {
            const parsed = analyzeSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid analyze payload.', details: parsed.error.flatten() });
            }
            const { text, protocol, demographics, pain_score, onset, attachments, case_id } = parsed.data;
            const resolvedCaseId = case_id || (0, case_store_1.createCaseRecord)('Patient Draft', demographics).case_id;
            (0, case_store_1.upsertCaseIntake)(resolvedCaseId, {
                text,
                attachments_count: attachments?.length || 0,
                setup: demographics
            });
            (0, case_store_1.updateCaseStatus)(resolvedCaseId, 'analyzing');
            const result = await (0, pipeline_1.runOrchestrationPipeline)(text, protocol || 'generic', demographics, pain_score || 0, onset || 'unknown', attachments || []);
            (0, case_store_1.storeCaseResult)(resolvedCaseId, result);
            return { status: 'completed', case_id: resolvedCaseId, result };
        }
        catch (e) {
            server.log.error(e);
            const parsed = analyzeSchema.safeParse(request.body);
            if (parsed.success && parsed.data.case_id) {
                (0, case_store_1.updateCaseStatus)(parsed.data.case_id, 'error', e.message);
            }
            return reply.code(502).send({
                status: 'error',
                source: 'bedrock',
                error: e.message || 'Nova analysis failed.',
                user_message: 'Nova analysis is temporarily unavailable. You can retry or continue the demo with a different scenario.'
            });
        }
    });
    server.post('/report-analyze', async (request, reply) => {
        try {
            const parsed = reportSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid report payload.', details: parsed.error.flatten() });
            }
            const { text, language, attachments } = parsed.data;
            const result = await (0, pipeline_1.runReportAnalysis)(text, language || 'en', attachments || []);
            return { status: 'completed', result };
        }
        catch (e) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });
    server.post('/medication-info', async (request, reply) => {
        try {
            const parsed = medicationSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid medication payload.', details: parsed.error.flatten() });
            }
            const result = await (0, pipeline_1.runMedicationLookup)(parsed.data);
            return { status: 'completed', result };
        }
        catch (e) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });
    server.get('/result/:id', async (request, reply) => {
        const params = zod_1.z.object({ id: zod_1.z.string() }).safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ status: 'error', error: 'Invalid case id.' });
        }
        const record = (0, case_store_1.getCaseRecord)(params.data.id);
        if (!record) {
            return reply.code(404).send({ status: 'error', error: 'Case not found.' });
        }
        if (!record.latest_result) {
            return reply.send({ status: record.status, case: record });
        }
        return { status: 'completed', case: record, result: record.latest_result };
    });
};
exports.caseRoutes = caseRoutes;
