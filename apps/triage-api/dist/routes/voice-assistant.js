"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voiceAssistantRoutes = void 0;
const zod_1 = require("zod");
const node_crypto_1 = require("node:crypto");
const bedrock_1 = require("../services/nova-clients/bedrock");
const case_store_1 = require("../services/case-store");
const voiceTurnSchema = zod_1.z.object({
    caseId: zod_1.z.string(),
    sessionId: zod_1.z.string().optional(),
    audioBase64: zod_1.z.string(),
    mimeType: zod_1.z.string().optional(),
    conversation: zod_1.z.array(zod_1.z.object({
        role: zod_1.z.enum(['user', 'assistant']),
        text: zod_1.z.string(),
        intent: zod_1.z.string().optional()
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
const voiceAssistantFallbackSchema = zod_1.z.object({
    intent: zod_1.z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
    response_text: zod_1.z.string().min(1),
    clarification_questions: zod_1.z.array(zod_1.z.string()).default([])
});
const voiceSessions = new Map();
const voiceSessionIdsByCaseId = new Map();
const voiceAssistantManagerSchema = zod_1.z.object({
    intent: zod_1.z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
    response_text: zod_1.z.string().min(1),
    clarification_questions: zod_1.z.array(zod_1.z.string()).default([]),
    updated_state: zod_1.z.object({
        lastIntent: zod_1.z.enum(['symptom_analysis', 'medication_guidance', 'out_of_scope']),
        pendingSlot: zod_1.z.enum(['medication_weight_kg', 'symptom_details']).nullable(),
        medicationName: zod_1.z.string().nullable(),
        language: zod_1.z.enum(['it', 'en'])
    })
});
const VOICE_ASSISTANT_FALLBACK_PROMPT = `You are Nova Triage, a strict clinical voice assistant fallback.

You will receive:
- the current user transcript (the latest message)
- the full recent conversation history (recent_conversation) — read this FIRST
- optional case context

CRITICAL RULE — CONTEXT-FIRST EVALUATION:
Before deciding the intent of the latest user message, ALWAYS read recent_conversation first.
A short message like "20 kg" or "venti chili" is NOT out_of_scope if the previous assistant turn asked for the child's weight.

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
- If the previous turn asked for weight and the user provides it, intent = "medication_guidance".
- If the user asks anything else with no prior context: intent = "out_of_scope".
- Keep response_text concise for voice playback: 1 to 3 short sentences.
- Never give a definitive diagnosis.
- Never prescribe or issue a medical order.
- For medication dosage questions, provide only general informational guidance and explicitly say pediatric or individualized dosing must be confirmed with a clinician or pharmacist.
- If key information is missing, ask at most one clarification question and include it in clarification_questions.
- Do not repeat the user request verbatim as the main answer.
- JSON only. No markdown.`;
const VOICE_ASSISTANT_MANAGER_PROMPT = `You are Nova Triage's dialogue manager.

You receive:
- the full conversation history so far (recent_conversation)
- the current user transcript (the latest message, already appended to history)
- the current session state (previous_state): lastIntent, pendingSlot, medicationName
- optional case context

CRITICAL RULE — CONTEXT-FIRST EVALUATION:
Before deciding the intent of the latest user message, ALWAYS read the full recent_conversation and previous_state first.
The latest message MUST be interpreted in light of what was previously said.

Examples:
- If a previous assistant turn asked "Quanto pesa il bambino?" or "How much does the child weigh?", then a reply like "20 kg" or "venti chili" is NOT out_of_scope — it is a medication_guidance follow-up.
- If previous_state.pendingSlot is "medication_weight_kg", any short numeric or weight answer continues the medication flow.
- If previous_state.pendingSlot is "symptom_details", any short follow-up continues the symptom_analysis flow.
- Never judge a message as out_of_scope if the conversation history makes its meaning clear.

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
- ALWAYS use full conversation context — never evaluate the latest utterance in isolation.
- If previous_state.pendingSlot is "medication_weight_kg" and the user provides a weight (e.g. "20 kg", "venti chili", "pesa 18"), intent = "medication_guidance". Respond with the dosage range.
- If previous_state.pendingSlot is "symptom_details", short answers (e.g. "da ieri", "since this morning") are still symptom_analysis.
- Keep response_text concise for voice playback: 1 to 3 short sentences.
- Respond in the same language as the user.
- Never give a definitive diagnosis.
- Never prescribe or issue a medical order.
- For pediatric or individualized dosing, provide only general informational ranges and explicitly say they must be confirmed with a clinician or pharmacist.
- Ask at most one clarification question when a key slot is still missing.
- Do not output markdown.
- JSON only.`;
const detectItalian = (text) => /(?:\bciao\b|\bdose\b|\bbambin|\banni\b|\bfarmaco\b|\btachipirina\b|\bmal di\b|\bdolore\b|\bquanto\b|\bposologia\b)/i.test(text);
const extractMedicationName = (text) => {
    const normalized = text.toLowerCase();
    if (/(tachipirina|paracetamol|paracetamolo)/i.test(normalized))
        return 'paracetamol';
    if (/(ibuprofen|ibuprofene|nurofen)/i.test(normalized))
        return 'ibuprofen';
    return null;
};
const extractWeightKg = (text) => {
    const match = text.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kg|chili|kili|chilogrammi)/i);
    if (!match)
        return null;
    return Number(match[1].replace(',', '.'));
};
const detectMedicationIntent = (text) => /(tachipirina|paracetamol|paracetamolo|ibuprofen|ibuprofene|farmaco|medicina|dose|dosaggio|posologia|side effect|effetti|interazioni|contraindic)/i.test(text);
const detectSymptomIntent = (text) => /(febbre|tosse|dolore|mal di|respiro|dispnea|nausea|vomito|rash|capogiri|headache|pain|fever|cough|breath|symptom|sintom)/i.test(text);
const detectOutOfScopeReply = (text) => /(fuori ambito|out of scope|posso aiutare solo|i can only help|limited to triage|solo con sintomi)/i.test(text);
const detectWeightClarification = (text) => /(quanto pesa|what does .* weigh|how much does .* weigh|peso.*kg|weight.*kg|peso in chili|weight in kilograms)/i.test(text);
const detectSymptomClarification = (text) => /(da quanto tempo|how long|sintomo principale|main symptom|febbre|breathing difficulty|difficolta respiratoria|dolore forte|severe pain)/i.test(text);
const inferIntentFromTurn = (transcript, assistantReply, session) => {
    if (session?.lastIntent === 'medication_guidance' &&
        session?.pendingSlot === 'medication_weight_kg' &&
        typeof extractWeightKg(transcript) === 'number') {
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
const buildLocalVoiceAssistantFallback = (transcript, session) => {
    const normalized = transcript.toLowerCase();
    const isItalian = session?.language === 'it' || detectItalian(transcript);
    const extractedWeightKg = extractWeightKg(transcript);
    const sessionMedicationName = session?.medicationName;
    const followUpWeightForMedication = session?.lastIntent === 'medication_guidance' &&
        session?.pendingSlot === 'medication_weight_kg' &&
        typeof extractedWeightKg === 'number';
    if (followUpWeightForMedication) {
        if (sessionMedicationName === 'paracetamol') {
            const minDoseMg = Math.round(extractedWeightKg * 10);
            const maxDoseMg = Math.round(extractedWeightKg * 15);
            return {
                intent: 'medication_guidance',
                response_text: isItalian
                    ? `Grazie. Per paracetamolo il range pediatrico informativo comunemente usato e circa ${minDoseMg}-${maxDoseMg} mg per dose, in base al peso. Verifica sempre concentrazione del prodotto, intervallo tra le dosi e dose massima giornaliera con pediatra o farmacista.`
                    : `Thanks. For paracetamol, a commonly used informational pediatric range is about ${minDoseMg}-${maxDoseMg} mg per dose, based on weight. Always verify product concentration, dosing interval, and maximum daily dose with a clinician or pharmacist.`,
                clarification_questions: []
            };
        }
        return {
            intent: 'medication_guidance',
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
            intent: 'medication_guidance',
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
            intent: 'symptom_analysis',
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
        intent: 'out_of_scope',
        response_text: isItalian
            ? 'Posso aiutare solo con sintomi, triage e informazioni generali sui farmaci.'
            : 'I can only help with symptoms, triage, and general medication information.',
        clarification_questions: []
    };
};
const buildVoiceAssistantFallback = async (transcript, caseContext, conversation = []) => {
    const raw = await (0, bedrock_1.invokeNovaLite)(VOICE_ASSISTANT_FALLBACK_PROMPT, JSON.stringify({
        user_transcript: transcript,
        recent_conversation: conversation,
        case_context: caseContext
    }));
    const parsed = voiceAssistantFallbackSchema.parse(JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()));
    return parsed;
};
const buildVoiceAssistantManagerReply = async (transcript, caseContext, session, caseId, conversation = []) => {
    const previousState = session
        ? {
            lastIntent: session.lastIntent,
            pendingSlot: session.pendingSlot,
            medicationName: session.medicationName,
            language: session.language
        }
        : null;
    // Format conversation as a readable transcript string for clarity
    const conversationText = conversation.length > 0
        ? conversation.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n')
        : '(no prior turns)';
    const raw = await (0, bedrock_1.invokeNovaLite)(VOICE_ASSISTANT_MANAGER_PROMPT, JSON.stringify({
        instruction: 'Read previous_state and recent_conversation_text BEFORE evaluating the latest user message.',
        previous_state: previousState,
        recent_conversation_text: conversationText,
        latest_user_message: transcript,
        recent_conversation: conversation,
        case_id: caseId,
        case_context: caseContext
    }));
    return voiceAssistantManagerSchema.parse(JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()));
};
const voiceAssistantRoutes = async (server) => {
    server.post('/turn', async (request, reply) => {
        try {
            const parsed = voiceTurnSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ status: 'error', error: 'Invalid voice turn payload.' });
            }
            const { caseId, audioBase64, sessionId: providedSessionId, conversation = [] } = parsed.data;
            const resolvedSessionId = providedSessionId || voiceSessionIdsByCaseId.get(caseId) || (0, node_crypto_1.randomUUID)();
            const sessionId = resolvedSessionId;
            let existingSession = voiceSessions.get(sessionId) || null;
            const record = (0, case_store_1.getCaseRecord)(caseId);
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
            const { transcript, userTranscript, assistantTranscript, audioBytes } = await (0, bedrock_1.invokeNovaSonic)(contextBuilder, audioBase64, { sampleRateHertz: 16000 });
            const resolvedUserTranscript = userTranscript || transcript;
            const assistantLooksOutOfScope = detectOutOfScopeReply(assistantTranscript);
            const needsFallbackReply = !assistantTranscript.trim() ||
                assistantTranscript.trim().toLowerCase() === resolvedUserTranscript.trim().toLowerCase() ||
                (Boolean(existingSession?.pendingSlot) &&
                    assistantLooksOutOfScope);
            let managerReply = null;
            if (resolvedUserTranscript) {
                try {
                    managerReply = await buildVoiceAssistantManagerReply(resolvedUserTranscript, contextBuilder, existingSession, caseId, conversation);
                }
                catch (managerError) {
                    server.log.warn(managerError);
                }
            }
            let fallbackReply = null;
            if (!managerReply && needsFallbackReply && resolvedUserTranscript) {
                try {
                    fallbackReply = await buildVoiceAssistantFallback(resolvedUserTranscript, contextBuilder, conversation);
                }
                catch (fallbackError) {
                    server.log.warn(fallbackError);
                    fallbackReply = buildLocalVoiceAssistantFallback(resolvedUserTranscript, existingSession);
                }
            }
            const resolvedIntent = managerReply?.intent ||
                fallbackReply?.intent ||
                inferIntentFromTurn(resolvedUserTranscript, assistantTranscript, existingSession);
            const nextState = managerReply
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
                if (resolvedIntent === 'medication_guidance' &&
                    (fallbackReply?.clarification_questions || []).length > 0 &&
                    /(peso|weight|kg|chili)/i.test((fallbackReply?.clarification_questions || []).join(' '))) {
                    nextState.pendingSlot = 'medication_weight_kg';
                }
                if (resolvedIntent === 'medication_guidance' &&
                    !nextState.pendingSlot &&
                    detectWeightClarification(assistantTranscript)) {
                    nextState.pendingSlot = 'medication_weight_kg';
                }
                if (resolvedIntent === 'symptom_analysis' &&
                    (fallbackReply?.clarification_questions || []).length > 0) {
                    nextState.pendingSlot = 'symptom_details';
                }
                if (resolvedIntent === 'symptom_analysis' &&
                    !nextState.pendingSlot &&
                    detectSymptomClarification(assistantTranscript)) {
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
        }
        catch (e) {
            server.log.error(e);
            return reply.code(500).send({ status: 'error', error: e.message || 'Voice assistant failed' });
        }
    });
    server.delete('/session/:id', async (request, reply) => {
        const params = zod_1.z.object({ id: zod_1.z.string() }).safeParse(request.params);
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
exports.voiceAssistantRoutes = voiceAssistantRoutes;
