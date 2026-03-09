import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { runOrchestrationPipeline } from '../services/agent-orchestrator/pipeline';
import { invokeNovaSonic } from '../services/nova-clients/bedrock';

export const caseRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
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

    server.post<{ Body: { audio_base64: string } }>('/voice', async (request, reply) => {
        try {
            const { audio_base64 } = request.body;
            const transcript = await invokeNovaSonic(
                "You are an expert clinical transcriber. Transcribe the patient's symptoms exactly as spoken. Ignore background noise. Return only the raw text transcript, no surrounding markdown.",
                audio_base64
            );
            return { transcript: transcript.trim() };
        } catch (e: any) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });

    server.post<{ Body: { text: string; case_id: string; protocol: string; demographics?: any; pain_score?: number; onset?: string; attachments?: any[] } }>('/analyze', async (request, reply) => {
        try {
            const { text, protocol, demographics, pain_score, onset, attachments } = request.body;
            const result = await runOrchestrationPipeline(text, protocol || 'generic', demographics, pain_score, onset, attachments);
            return { status: 'completed', result };
        } catch (e: any) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message });
        }
    });

    server.get('/result/:id', async (request, reply) => {
        // Return mock since we skipped DynamoDB persistence for now constraints
        return { status: 'completed', result: { urgency_level: 'pending' } };
    });
};
