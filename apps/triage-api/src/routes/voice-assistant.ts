import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { invokeNovaLite, invokeNovaSonic } from '../services/nova-clients/bedrock';
import { getCaseRecord } from '../services/case-store';

const voiceTurnSchema = z.object({
    caseId: z.string(),
    sessionId: z.string().optional(),
    audioBase64: z.string(),
    mimeType: z.string().optional(),
    conversation: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string(),
        intent: z.string().optional()
    })).optional()
});

const SYSTEM_PROMPT = `You are Nova Triage, an expert clinical voice assistant. 
Your ONLY purpose is to discuss:
1. Patient's current symptoms, triage, and urgency levels.
2. Information about medications, dosages, side effects, and interactions.

You are polyglot. Always reply in the exact same language the user speaks to you in (especially Italian and English).

STRICT BOUNDARY RULES:
- If the user asks about ANY topic outside of triage/symptoms or medication info, politely REFUSE to answer.
- Say you are limited to triage and medication assistance.
- If they ask for a final diagnosis, refuse and say you only provide differential triage possibilities.
- Keep responses extremely succinct (1-3 sentences max) because they will be read aloud.
- Ask max one clarification question at a time if you need more symptom details.
`;

const voiceAssistantFallbackSchema = z.object({
    intent: z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
    response_text: z.string().min(1),
    clarification_questions: z.array(z.string()).default([])
});

type VoiceSessionState = {
    caseId: string;
    lastIntent: 'symptom_analysis' | 'medication_guidance' | 'out_of_scope' | null;
    pendingSlot: 'medication_weight_kg' | 'symptom_details' | null;
    medicationName: string | null;
    language: 'it' | 'en';
    updatedAt: number;
};

const voiceSessions = new Map<string, VoiceSessionState>();
const voiceSessionIdsByCaseId = new Map<string, string>();

const voiceAssistantManagerSchema = z.object({
    intent: z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
    response_text: z.string().min(1),
    clarification_questions: z.array(z.string()).default([]),
    updated_state: z.object({
        lastIntent: z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
        pendingSlot: z.enum(['medication_weight_kg', 'symptom_details']).nullable(),
        medicationName: z.string().nullable(),
        language: z.enum(['it', 'en'])
    })
});

const VOICE_ASSISTANT_FALLBACK_PROMPT = `You are Nova Triage, a strict clinical voice assistant fallback.

You will receive a user transcript plus optional case context.

Return JSON only with this exact shape:
{
  "intent": "symptom_analysis" | "medication_guidance" | "out_of_scope",
  "response_text": "string",
  "clarification_questions": ["string"]
}

Rules:
- Respond in the exact same language used by the user.
- If the user asks about symptoms, urgency, triage, red flags, or what to do next: intent = "symptom_analysis".
- If the user asks about a medication, dosage ranges, side effects, contraindications, or interactions: intent = "medication_guidance".
- If the user asks anything else: intent = "out_of_scope".
- Keep response_text concise for voice playback: 1 to 3 short sentences.
- Never give a definitive diagnosis.
- Never prescribe or issue a medical order.
- For medication dosage questions, provide only general informational guidance and explicitly say pediatric or individualized dosing must be confirmed with a clinician or pharmacist.
- If key information is missing, ask at most one clarification question and include it in clarification_questions.
- Do not repeat the user request verbatim as the main answer.
- JSON only. No markdown.`;

const VOICE_ASSISTANT_MANAGER_PROMPT = `You are Nova Triage's dialogue manager.

You receive:
- the current user transcript
- current case context
- previous conversation state

Your job is to understand the user's intent in context, update the state, and generate the next assistant reply.

Return JSON only with this exact shape:
{
  "intent": "symptom_analysis" | "medication_guidance" | "out_of_scope",
  "response_text": "string",
  "clarification_questions": ["string"],
  "updated_state": {
    "lastIntent": "symptom_analysis" | "medication_guidance" | "out_of_scope",
    "pendingSlot": "medication_weight_kg" | "symptom_details" | null,
    "medicationName": "string or null",
    "language": "it" | "en"
  }
}

Rules:
- Use conversation context, not just the latest utterance.
- If the previous state is medication_guidance and pendingSlot is medication_weight_kg, then an utterance like "36 kg" or "the child weighs 36 kg" is a medication follow-up, not out of scope.
- If the previous state is symptom_analysis and pendingSlot is symptom_details, short follow-up answers are still in triage context.
- Keep response_text concise for voice playback: 1 to 3 short sentences.
- Respond in the same language as the user.
- Never give a definitive diagnosis.
- Never prescribe or issue a medical order.
- For pediatric or individualized dosing, provide only general informational ranges and explicitly say they must be confirmed with a clinician or pharmacist.
- Ask at most one clarification question when a key slot is missing.
- Do not output markdown.
- JSON only.`;

const detectItalian = (text: string) => /(?:\bciao\b|\bdose\b|\bbambin|\banni\b|\bfarmaco\b|\btachipirina\b|\bmal di\b|\bdolore\b|\bquanto\b|\bposologia\b)/i.test(text);

const extractMedicationName = (text: string) => {
    const normalized = text.toLowerCase();
    if (/(tachipirina|paracetamol|paracetamolo)/i.test(normalized)) return 'paracetamol';
    if (/(ibuprofen|ibuprofene|nurofen)/i.test(normalized)) return 'ibuprofen';
    return null;
};

const extractWeightKg = (text: string) => {
    const match = text.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kg|chili|kili|chilogrammi)/i);
    if (!match) return null;
    return Number(match[1].replace(',', '.'));
};

const detectMedicationIntent = (text: string) =>
    /(tachipirina|paracetamol|paracetamolo|ibuprofen|ibuprofene|farmaco|medicina|dose|dosaggio|posologia|side effect|effetti|interazioni|contraindic)/i.test(text);

const detectSymptomIntent = (text: string) =>
    /(febbre|tosse|dolore|mal di|respiro|dispnea|nausea|vomito|rash|capogiri|headache|pain|fever|cough|breath|symptom|sintom)/i.test(text);

const detectOutOfScopeReply = (text: string) =>
    /(fuori ambito|out of scope|posso aiutare solo|i can only help|limited to triage|solo con sintomi)/i.test(text);

const detectWeightClarification = (text: string) =>
    /(quanto pesa|what does .* weigh|how much does .* weigh|peso.*kg|weight.*kg|peso in chili|weight in kilograms)/i.test(text);

const detectSymptomClarification = (text: string) =>
    /(da quanto tempo|how long|sintomo principale|main symptom|febbre|breathing difficulty|difficolta respiratoria|dolore forte|severe pain)/i.test(text);

const inferIntentFromTurn = (
    transcript: string,
    assistantReply: string,
    session?: VoiceSessionState | null
): 'symptom_analysis' | 'medication_guidance' | 'out_of_scope' => {
    if (
        session?.lastIntent === 'medication_guidance' &&
        session?.pendingSlot === 'medication_weight_kg' &&
        typeof extractWeightKg(transcript) === 'number'
    ) {
        return 'medication_guidance';
    }

    if (detectMedicationIntent(transcript) || /peso|weight|kg|chili/i.test(assistantReply)) {
        return 'medication_guidance';
    }
    if (detectSymptomIntent(transcript)) {
        return 'symptom_analysis';
    }
    if (detectOutOfScopeReply(assistantReply)) {
        return 'out_of_scope';
    }
    return session?.lastIntent || 'symptom_analysis';
};

const buildLocalVoiceAssistantFallback = (transcript: string, session?: VoiceSessionState | null) => {
    const normalized = transcript.toLowerCase();
    const isItalian = session?.language === 'it' || detectItalian(transcript);
    const extractedWeightKg = extractWeightKg(transcript);
    const sessionMedicationName = session?.medicationName;
    const followUpWeightForMedication =
        session?.lastIntent === 'medication_guidance' &&
        session?.pendingSlot === 'medication_weight_kg' &&
        typeof extractedWeightKg === 'number';

    if (followUpWeightForMedication) {
        if (sessionMedicationName === 'paracetamol') {
            const minDoseMg = Math.round(extractedWeightKg * 10);
            const maxDoseMg = Math.round(extractedWeightKg * 15);
            return {
                intent: 'medication_guidance' as const,
                response_text: isItalian
                    ? `Grazie. Per paracetamolo il range pediatrico informativo comunemente usato e circa ${minDoseMg}-${maxDoseMg} mg per dose, in base al peso. Verifica sempre concentrazione del prodotto, intervallo tra le dosi e dose massima giornaliera con pediatra o farmacista.`
                    : `Thanks. For paracetamol, a commonly used informational pediatric range is about ${minDoseMg}-${maxDoseMg} mg per dose, based on weight. Always verify product concentration, dosing interval, and maximum daily dose with a clinician or pharmacist.`,
                clarification_questions: []
            };
        }

        return {
            intent: 'medication_guidance' as const,
            response_text: isItalian
                ? `Grazie. Con ${extractedWeightKg} kg posso inquadrare meglio la richiesta farmaco, ma il range dipende dal principio attivo e dalla formulazione. Dimmi il nome del farmaco o il dosaggio riportato sulla confezione.`
                : `Thanks. With ${extractedWeightKg} kg I can narrow the medication question better, but the range depends on the drug and formulation. Tell me the medication name or the strength shown on the package.`,
            clarification_questions: [
                isItalian
                    ? 'Qual e il nome del farmaco o il dosaggio in confezione?'
                    : 'What is the medication name or strength on the package?'
            ]
        };
    }

    const medicationIntent = detectMedicationIntent(normalized);
    const symptomIntent = detectSymptomIntent(normalized);

    if (medicationIntent) {
        return {
            intent: 'medication_guidance' as const,
            response_text: isItalian
                ? 'Posso dare solo indicazioni generali sul farmaco. Per un bambino di sei anni la dose dipende soprattutto dal peso: dimmi il peso in chili e ti do un range informativo da verificare con pediatra o farmacista.'
                : 'I can only provide general medication guidance. For a six-year-old child, dosing depends mainly on weight: tell me the weight in kilograms and I will give an informational range to verify with a clinician or pharmacist.',
            clarification_questions: [
                isItalian
                    ? 'Quanto pesa il bambino in chili?'
                    : 'How much does the child weigh in kilograms?'
            ]
        };
    }

    if (symptomIntent) {
        return {
            intent: 'symptom_analysis' as const,
            response_text: isItalian
                ? 'Posso aiutarti con triage e sintomi. Dimmi il sintomo principale, da quanto tempo dura e se ci sono febbre, difficolta respiratoria o dolore forte.'
                : 'I can help with symptoms and triage. Tell me the main symptom, how long it has been present, and whether there is fever, breathing difficulty, or severe pain.',
            clarification_questions: [
                isItalian
                    ? 'Qual e il sintomo principale e da quanto tempo dura?'
                    : 'What is the main symptom and how long has it been present?'
            ]
        };
    }

    return {
        intent: 'out_of_scope' as const,
        response_text: isItalian
            ? 'Posso aiutare solo con sintomi, triage e informazioni generali sui farmaci.'
            : 'I can only help with symptoms, triage, and general medication information.',
        clarification_questions: []
    };
};

const buildVoiceAssistantFallback = async (transcript: string, caseContext: string) => {
    const raw = await invokeNovaLite(
        VOICE_ASSISTANT_FALLBACK_PROMPT,
        JSON.stringify({
            user_transcript: transcript,
            case_context: caseContext
        })
    );

    const parsed = voiceAssistantFallbackSchema.parse(JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()));
    return parsed;
};

const buildVoiceAssistantManagerReply = async (
    transcript: string,
    caseContext: string,
    session: VoiceSessionState | null,
    caseId: string,
    conversation: Array<{ role: 'user' | 'assistant'; text: string; intent?: string }> = []
) => {
    const raw = await invokeNovaLite(
        VOICE_ASSISTANT_MANAGER_PROMPT,
        JSON.stringify({
            case_id: caseId,
            user_transcript: transcript,
            case_context: caseContext,
            recent_conversation: conversation,
            previous_state: session
                ? {
                    lastIntent: session.lastIntent,
                    pendingSlot: session.pendingSlot,
                    medicationName: session.medicationName,
                    language: session.language
                }
                : null
        })
    );

    return voiceAssistantManagerSchema.parse(JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()));
};

export const voiceAssistantRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.post('/turn', async (request, reply) => {
        try {
            const parsed = voiceTurnSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid voice turn payload.' });
            }

            const { caseId, audioBase64, sessionId: providedSessionId, conversation = [] } = parsed.data;
            const resolvedSessionId = providedSessionId || voiceSessionIdsByCaseId.get(caseId) || randomUUID();
            const sessionId = resolvedSessionId;
            let existingSession = voiceSessions.get(sessionId) || null;
            const record = getCaseRecord(caseId);

            if (!existingSession && conversation.length > 0) {
                const lastAssistantTurn = [...conversation].reverse().find((turn) => turn.role === 'assistant');
                const lastUserTurn = [...conversation].reverse().find((turn) => turn.role === 'user');
                existingSession = {
                    caseId,
                    lastIntent: (lastAssistantTurn?.intent === 'medication_guidance' || lastAssistantTurn?.intent === 'symptom_analysis' || lastAssistantTurn?.intent === 'out_of_scope')
                        ? lastAssistantTurn.intent
                        : null,
                    pendingSlot: lastAssistantTurn?.text && detectWeightClarification(lastAssistantTurn.text)
                        ? 'medication_weight_kg'
                        : lastAssistantTurn?.text && detectSymptomClarification(lastAssistantTurn.text)
                        ? 'symptom_details'
                        : null,
                    medicationName: extractMedicationName(lastUserTurn?.text || '') || null,
                    language: detectItalian(lastUserTurn?.text || lastAssistantTurn?.text || '') ? 'it' : 'en',
                    updatedAt: Date.now()
                };
            }
            
            let contextBuilder = SYSTEM_PROMPT;
            if (existingSession) {
                contextBuilder += `\n\nConversation Memory:\nLast intent: ${existingSession.lastIntent || 'unknown'}\nPending slot: ${existingSession.pendingSlot || 'none'}\nMedication in discussion: ${existingSession.medicationName || 'unknown'}`;
            }
            if (record) {
                contextBuilder += `\n\nCurrent Case Context:\nDemographics: ${JSON.stringify(record.setup || {})}`;
                contextBuilder += `\nIntake Text: ${record.intake?.text || 'N/A'}`;
                if (record.latest_result) {
                    contextBuilder += `\nUrgency: ${record.latest_result.urgency_level}`;
                }
            }

            const { transcript, userTranscript, assistantTranscript, audioBytes } = await invokeNovaSonic(
                contextBuilder,
                audioBase64,
                { sampleRateHertz: 16000 }
            );

            const resolvedUserTranscript = userTranscript || transcript;
            const assistantLooksOutOfScope = detectOutOfScopeReply(assistantTranscript);
            const needsFallbackReply =
                !assistantTranscript.trim() ||
                assistantTranscript.trim().toLowerCase() === resolvedUserTranscript.trim().toLowerCase() ||
                (
                    Boolean(existingSession?.pendingSlot) &&
                    assistantLooksOutOfScope
                );

            let managerReply = null;
            if (resolvedUserTranscript) {
                try {
                    managerReply = await buildVoiceAssistantManagerReply(
                        resolvedUserTranscript,
                        contextBuilder,
                        existingSession,
                        caseId,
                        conversation
                    );
                } catch (managerError) {
                    server.log.warn(managerError);
                }
            }

            let fallbackReply = null;
            if (!managerReply && needsFallbackReply && resolvedUserTranscript) {
                try {
                    fallbackReply = await buildVoiceAssistantFallback(resolvedUserTranscript, contextBuilder);
                } catch (fallbackError) {
                    server.log.warn(fallbackError);
                    fallbackReply = buildLocalVoiceAssistantFallback(resolvedUserTranscript, existingSession);
                }
            }

            const resolvedIntent =
                managerReply?.intent ||
                fallbackReply?.intent ||
                inferIntentFromTurn(resolvedUserTranscript, assistantTranscript, existingSession);
            const nextState: VoiceSessionState = managerReply
                ? {
                    caseId,
                    lastIntent: managerReply.updated_state.lastIntent,
                    pendingSlot: managerReply.updated_state.pendingSlot,
                    medicationName: managerReply.updated_state.medicationName,
                    language: managerReply.updated_state.language,
                    updatedAt: Date.now()
                }
                : {
                    caseId,
                    lastIntent: resolvedIntent,
                    pendingSlot: null,
                    medicationName: extractMedicationName(resolvedUserTranscript) || existingSession?.medicationName || null,
                    language: detectItalian(resolvedUserTranscript) ? 'it' : 'en',
                    updatedAt: Date.now()
                };

            if (!managerReply) {
                if (
                    resolvedIntent === 'medication_guidance' &&
                    (fallbackReply?.clarification_questions || []).length > 0 &&
                    /(peso|weight|kg|chili)/i.test((fallbackReply?.clarification_questions || []).join(' '))
                ) {
                    nextState.pendingSlot = 'medication_weight_kg';
                }

                if (
                    resolvedIntent === 'medication_guidance' &&
                    !nextState.pendingSlot &&
                    detectWeightClarification(assistantTranscript)
                ) {
                    nextState.pendingSlot = 'medication_weight_kg';
                }

                if (
                    resolvedIntent === 'symptom_analysis' &&
                    (fallbackReply?.clarification_questions || []).length > 0
                ) {
                    nextState.pendingSlot = 'symptom_details';
                }

                if (
                    resolvedIntent === 'symptom_analysis' &&
                    !nextState.pendingSlot &&
                    detectSymptomClarification(assistantTranscript)
                ) {
                    nextState.pendingSlot = 'symptom_details';
                }
            }

            voiceSessions.set(sessionId, nextState);
            voiceSessionIdsByCaseId.set(caseId, sessionId);

            // Nova Sonic returns the transcript. If it contains both USER and ASSISTANT, 
            // the frontend chat will display the entire block if we aren't careful.
            // But since this is a voice-first UI, we'll return the full transcript generated in this turn.
            return {
                sessionId,
                transcript: resolvedUserTranscript,
                responseText: managerReply?.response_text || fallbackReply?.response_text || assistantTranscript || '',
                responseAudioBase64: managerReply ? null : (audioBytes ? audioBytes.toString('base64') : null),
                responseMimeType: 'audio/pcm',
                intent: resolvedIntent,
                clarificationQuestions: managerReply?.clarification_questions || fallbackReply?.clarification_questions || []
            };

        } catch (e: any) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message || 'Voice assistant failed' });
        }
    });

    server.delete('/session/:id', async (request, reply) => {
        const params = z.object({ id: z.string() }).safeParse(request.params);
        if (params.success) {
            const session = voiceSessions.get(params.data.id);
            if (session) {
                voiceSessionIdsByCaseId.delete(session.caseId);
            }
            voiceSessions.delete(params.data.id);
        }
        return { status: 'completed' };
    });
};
