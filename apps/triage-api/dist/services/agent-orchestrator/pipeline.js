"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMedicationLookup = exports.runReportAnalysis = exports.runOrchestrationPipeline = void 0;
const bedrock_1 = require("../nova-clients/bedrock");
const prompts_1 = require("prompts");
const safety_1 = require("./safety");
const cleanJSON = (str) => {
    return str.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
};
const parseJSON = (value) => JSON.parse(cleanJSON(value));
const inferSeverity = (value) => {
    const normalized = value.toLowerCase();
    if (/(urgent|critical|severe|important|significant|concerning|red flag)/.test(normalized))
        return 'high';
    if (/(monitor|follow-up|review|attention|abnormal)/.test(normalized))
        return 'moderate';
    return 'low';
};
const normalizeAttentionPoints = (attentionPoints) => {
    if (!Array.isArray(attentionPoints))
        return [];
    return attentionPoints
        .map((item) => {
        if (typeof item === 'string') {
            return { label: item, severity: inferSeverity(item) };
        }
        if (item && typeof item === 'object' && 'label' in item) {
            const entry = item;
            const label = typeof entry.label === 'string' ? entry.label : '';
            if (!label)
                return null;
            const severity = entry.severity === 'high' || entry.severity === 'moderate' || entry.severity === 'low'
                ? entry.severity
                : inferSeverity(label);
            return { label, severity };
        }
        return null;
    })
        .filter((item) => Boolean(item));
};
const buildMedicationGuardrails = (input) => {
    const isItalian = input.language?.toLowerCase().startsWith('it');
    const notes = [];
    notes.push(isItalian
        ? 'Questa scheda e la tabella dose sono solo supporto informativo, non una prescrizione.'
        : 'This overview and dose table are informational support only, not a prescription.');
    if (!input.age_years || !input.weight_kg) {
        notes.push(isItalian
            ? 'Mancano età o peso completi: ogni dose pediatrica o personalizzata va verificata con medico o farmacista.'
            : 'Age or weight is incomplete: any pediatric or individualized dose must be confirmed by a clinician or pharmacist.');
    }
    if (input.question && /(take now|double dose|prescribe|replace|switch|posso prendere|quante ne prendo|raddoppiare)/i.test(input.question)) {
        notes.push(isItalian
            ? 'La domanda richiede una decisione terapeutica individuale: il sistema può solo offrire informazioni generali.'
            : 'The question asks for an individualized treatment decision: the system can only provide general information.');
    }
    return notes;
};
const protocolLabels = {
    generic: 'Generic standard (5-level)',
    italy: 'Italian standard',
    home: 'Home care guide'
};
const resolveDestinationCode = (urgencyLevel) => {
    switch (urgencyLevel) {
        case 'critical':
            return 'ambulance';
        case 'high':
            return 'er';
        case 'moderate':
            return 'urgent_care';
        case 'low':
            return 'doctor';
        default:
            return 'home_care';
    }
};
const runOrchestrationPipeline = async (rawInput, protocol, demographics = {}, painScore = 0, onset = 'unknown', attachments = []) => {
    const auditTrail = [];
    const intakeContext = { raw_input: rawInput, demographics, pain_score: painScore, onset };
    const normOutput = parseJSON(await (0, bedrock_1.invokeNovaLite)(prompts_1.INTAKE_NORMALIZER_PROMPT, JSON.stringify(intakeContext)));
    auditTrail.push({ step: 'normalize_intake', status: 'completed', summary: 'Raw intake normalized for downstream clinical extraction.' });
    const structContext = { ...normOutput, demographics };
    const structOutput = parseJSON(await (0, bedrock_1.invokeNovaLite)(prompts_1.SYMPTOM_STRUCTURER_PROMPT, JSON.stringify(structContext)));
    auditTrail.push({ step: 'structure_symptoms', status: 'completed', summary: 'Symptoms converted into structured clinical fields.' });
    const safetyOutput = (0, safety_1.evaluateSafetyRules)({
        rawInput,
        normalizedText: normOutput.normalized_text,
        structuredSymptoms: structOutput,
        demographics,
        painScore,
        onset
    });
    auditTrail.push({
        step: 'safety_rules',
        status: safetyOutput.rules_triggered.length > 0 ? 'completed' : 'skipped',
        summary: safetyOutput.rules_triggered.length > 0
            ? `Deterministic safety rules triggered: ${safetyOutput.rules_triggered.join(', ')}.`
            : 'No deterministic safety rule override was triggered.'
    });
    let multimodalOutput = { extracted_findings: [], clinical_relevance: 'none' };
    if (attachments.length > 0) {
        multimodalOutput = parseJSON(await (0, bedrock_1.invokeNovaMultimodal)(process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0', prompts_1.MULTIMODAL_EXTRACTOR_PROMPT, JSON.stringify({ context: structOutput, demographics }), attachments));
        auditTrail.push({
            step: 'multimodal_extraction',
            status: 'completed',
            summary: `Processed ${attachments.length} attachment(s) for clinical findings.`
        });
    }
    else {
        auditTrail.push({ step: 'multimodal_extraction', status: 'skipped', summary: 'No attachments provided for multimodal extraction.' });
    }
    const riskContext = {
        symptoms: structOutput,
        rules: {
            critical_red_flags: safetyOutput.critical_red_flags,
            rules_triggered: safetyOutput.rules_triggered
        },
        findings: multimodalOutput.extracted_findings,
        demographics
    };
    const riskOutput = parseJSON(await (0, bedrock_1.invokeNovaLite)(prompts_1.RISK_CLASSIFIER_PROMPT, JSON.stringify(riskContext)));
    auditTrail.push({ step: 'risk_classification', status: 'completed', summary: `Model classified urgency as ${riskOutput.urgency_level}.` });
    const finalUrgency = safetyOutput.minimum_urgency
        ? (0, safety_1.getHigherUrgency)(riskOutput.urgency_level, safetyOutput.minimum_urgency)
        : riskOutput.urgency_level;
    const mergedRedFlags = Array.from(new Set([...riskOutput.risk_factors, ...safetyOutput.critical_red_flags]));
    const mergedReasoning = [
        ...(safetyOutput.deterministic_notes.length > 0 ? safetyOutput.deterministic_notes : []),
        ...riskOutput.reasoning_summary
    ];
    const finalRisk = {
        ...riskOutput,
        urgency_level: finalUrgency,
        risk_factors: mergedRedFlags,
        reasoning_summary: mergedReasoning
    };
    const clusterOutput = parseJSON(await (0, bedrock_1.invokeNovaPro)(prompts_1.DIFFERENTIAL_CLUSTER_PROMPT, JSON.stringify({ symptoms: structOutput, demographics })));
    auditTrail.push({ step: 'differential_clusters', status: 'completed', summary: `Generated ${clusterOutput.clusters.length} possible cluster(s).` });
    const handoffContext = {
        symptoms: structOutput,
        risk: finalRisk,
        clusters: clusterOutput.clusters,
        demographics,
        multimodal: multimodalOutput,
        safety: safetyOutput
    };
    const handoffOutput = parseJSON(await (0, bedrock_1.invokeNovaPro)(prompts_1.HANDOFF_COMPOSER_PROMPT, JSON.stringify(handoffContext)));
    auditTrail.push({ step: 'clinician_handoff', status: 'completed', summary: 'Generated clinician handoff summary.' });
    const patientOutput = parseJSON(await (0, bedrock_1.invokeNovaLite)(prompts_1.PATIENT_EXPLANATION_PROMPT, JSON.stringify(handoffContext)));
    auditTrail.push({ step: 'patient_summary', status: 'completed', summary: 'Generated patient-facing explanation and next steps.' });
    const suggestedDestinationCode = resolveDestinationCode(finalUrgency);
    return {
        urgency_level: finalUrgency,
        protocol_code: protocol,
        protocol_label: protocolLabels[protocol] || protocol,
        confidence: riskOutput.confidence,
        red_flags: mergedRedFlags,
        rules_triggered: safetyOutput.rules_triggered,
        safety_escalation_applied: Boolean(safetyOutput.minimum_urgency && safetyOutput.minimum_urgency !== riskOutput.urgency_level),
        deterministic_notes: safetyOutput.deterministic_notes,
        possible_clusters: clusterOutput.clusters,
        reasoning_summary: mergedReasoning,
        suggested_destination_code: suggestedDestinationCode,
        suggested_destination: suggestedDestinationCode,
        missing_information: safetyOutput.missing_information,
        clarification_questions: safetyOutput.clarification_questions,
        audit_trail: auditTrail,
        handoff_card_markdown: handoffOutput.handoff_card_markdown,
        patient_summary: patientOutput.patient_summary,
        next_steps: patientOutput.next_steps
    };
};
exports.runOrchestrationPipeline = runOrchestrationPipeline;
const runReportAnalysis = async (text, language, attachments = []) => {
    const payload = JSON.stringify({ text, language });
    if (attachments.length > 0) {
        const result = parseJSON(await (0, bedrock_1.invokeNovaMultimodal)(process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0', prompts_1.REPORT_ANALYSIS_PROMPT, payload, attachments));
        return {
            ...result,
            attention_points: normalizeAttentionPoints(result.attention_points)
        };
    }
    const result = parseJSON(await (0, bedrock_1.invokeNovaPro)(prompts_1.REPORT_ANALYSIS_PROMPT, payload));
    return {
        ...result,
        attention_points: normalizeAttentionPoints(result.attention_points)
    };
};
exports.runReportAnalysis = runReportAnalysis;
const runMedicationLookup = async (input) => {
    const result = parseJSON(await (0, bedrock_1.invokeNovaPro)(prompts_1.MEDICATION_OVERVIEW_PROMPT, JSON.stringify(input)));
    return {
        ...result,
        guardrails: result.guardrails?.length ? result.guardrails : buildMedicationGuardrails(input),
        disclaimer: result.disclaimer ||
            (input.language?.toLowerCase().startsWith('it')
                ? 'Supporto informativo soltanto. Verificare sempre con foglietto illustrativo, farmacista o medico.'
                : 'Informational support only. Always verify with the official leaflet, pharmacist, or clinician.')
    };
};
exports.runMedicationLookup = runMedicationLookup;
