"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.caseRoutes = void 0;
const pipeline_1 = require("../services/agent-orchestrator/pipeline");
const bedrock_1 = require("../services/nova-clients/bedrock");
const caseRoutes = async (server) => {
    server.post('/start', async (request, reply) => {
        const case_id = crypto.randomUUID();
        return { case_id, alias: 'Patient Draft' };
    });
    server.post('/intake', async (request, reply) => {
        return { accepted: true };
    });
    server.post('/clarify', async (request, reply) => {
        return { questions: [] };
    });
    server.post('/voice', async (request, reply) => {
        try {
            const { audio_base64 } = request.body;
            const transcript = await (0, bedrock_1.invokeNovaSonic)("You are an expert clinical transcriber. Transcribe the patient's symptoms exactly as spoken. Ignore background noise. Return only the raw text transcript, no surrounding markdown.", audio_base64);
            return { transcript: transcript.trim() };
        }
        catch (e) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });
    server.post('/analyze', async (request, reply) => {
        try {
            const { text, protocol, demographics, pain_score, onset, attachments } = request.body;
            const result = await (0, pipeline_1.runOrchestrationPipeline)(text, protocol || 'generic', demographics, pain_score, onset, attachments);
            return { status: 'completed', result };
        }
        catch (e) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });
    server.get('/result/:id', async (request, reply) => {
        // Return mock since we skipped DynamoDB persistence for now constraints
        return { status: 'completed', result: { urgency_level: 'pending' } };
    });
};
exports.caseRoutes = caseRoutes;
