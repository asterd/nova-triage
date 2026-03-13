import { invokeNovaLite, invokeNovaPro, invokeNovaMultimodal } from '../nova-clients/bedrock';
import {
    INTAKE_NORMALIZER_PROMPT,
    SYMPTOM_STRUCTURER_PROMPT,
    MULTIMODAL_EXTRACTOR_PROMPT,
    RISK_CLASSIFIER_PROMPT,
    DIFFERENTIAL_CLUSTER_PROMPT,
    HANDOFF_COMPOSER_PROMPT,
    PATIENT_EXPLANATION_PROMPT,
    REPORT_ANALYSIS_PROMPT,
    MEDICATION_OVERVIEW_PROMPT
} from 'prompts';
import { AIResult } from 'shared-types';
import { evaluateSafetyRules, getHigherUrgency } from './safety';

const cleanJSON = (str: string) => {
    return str.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
};

const extractBalancedJson = (value: string) => {
    const trimmed = cleanJSON(value);
    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    const start =
        objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);

    if (start === -1) {
        return trimmed;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let expectedClosing = trimmed[start] === '{' ? '}' : ']';

    for (let index = start; index < trimmed.length; index += 1) {
        const char = trimmed[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{' || char === '[') {
            depth += 1;
            continue;
        }

        if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0 && char === expectedClosing) {
                return trimmed.slice(start, index + 1);
            }
        }
    }

    return trimmed.slice(start);
};

const repairCommonJsonIssues = (value: string) =>
    value
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
        .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:\s*)([^,\]}\n"][^,\]}]*)(?=\s*[,}\]])/g, (_match, prefix, key, sep, rawValue) => {
            const candidate = String(rawValue).trim();
            if (!candidate) return `${prefix}"${key}"${sep}""`;
            if (/^(true|false|null|-?\d+(?:\.\d+)?)$/i.test(candidate)) return `${prefix}"${key}"${sep}${candidate}`;
            return `${prefix}"${key}"${sep}"${candidate.replace(/"/g, '\\"')}"`;
        });

const parseJSON = <T>(value: string): T => {
    const normalized = extractBalancedJson(value);

    try {
        return JSON.parse(normalized) as T;
    } catch (initialError) {
        const repaired = repairCommonJsonIssues(normalized);
        try {
            return JSON.parse(repaired) as T;
        } catch (repairError) {
            const snippet = repaired.slice(0, 600);
            const reason = repairError instanceof Error ? repairError.message : String(repairError || '');
            throw new SyntaxError(`Unable to parse model JSON: ${reason}. Payload snippet: ${snippet}`);
        }
    }
};

const inferSeverity = (value: string): 'high' | 'moderate' | 'low' => {
    const normalized = value.toLowerCase();
    if (/(urgent|critical|severe|important|significant|concerning|red flag)/.test(normalized)) return 'high';
    if (/(monitor|follow-up|review|attention|abnormal)/.test(normalized)) return 'moderate';
    return 'low';
};

const normalizeAttentionPoints = (attentionPoints: unknown) => {
    if (!Array.isArray(attentionPoints)) return [];

    return attentionPoints
        .map((item) => {
            if (typeof item === 'string') {
                return { label: item, severity: inferSeverity(item) };
            }

            if (item && typeof item === 'object' && 'label' in item) {
                const entry = item as { label?: unknown; severity?: unknown };
                const label = typeof entry.label === 'string' ? entry.label : '';
                if (!label) return null;
                const severity =
                    entry.severity === 'high' || entry.severity === 'moderate' || entry.severity === 'low'
                        ? entry.severity
                        : inferSeverity(label);
                return { label, severity };
            }

            return null;
        })
        .filter((item): item is { label: string; severity: 'high' | 'moderate' | 'low' } => Boolean(item));
};

const buildMedicationGuardrails = (input: {
    medication_name: string;
    age_years?: number;
    weight_kg?: number;
    question?: string;
    language: string;
}) => {
    const isItalian = input.language?.toLowerCase().startsWith('it');
    const notes: string[] = [];

    notes.push(
        isItalian
            ? 'Questa scheda e la tabella dose sono solo supporto informativo, non una prescrizione.'
            : 'This overview and dose table are informational support only, not a prescription.'
    );

    if (!input.age_years || !input.weight_kg) {
        notes.push(
            isItalian
                ? 'Mancano età o peso completi: ogni dose pediatrica o personalizzata va verificata con medico o farmacista.'
                : 'Age or weight is incomplete: any pediatric or individualized dose must be confirmed by a clinician or pharmacist.'
        );
    }

    if (input.question && /(take now|double dose|prescribe|replace|switch|posso prendere|quante ne prendo|raddoppiare)/i.test(input.question)) {
        notes.push(
            isItalian
                ? 'La domanda richiede una decisione terapeutica individuale: il sistema può solo offrire informazioni generali.'
                : 'The question asks for an individualized treatment decision: the system can only provide general information.'
        );
    }

    return notes;
};

type MedicationDoseRow = { population: string; dose: string; notes: string };

const getMedicationAudienceTerms = (input: { age_years?: number; weight_kg?: number; language: string }) => {
    const language = input.language?.toLowerCase().startsWith('it') ? 'it' : 'en';

    if (typeof input.age_years !== 'number') {
        return {
            terms: [] as string[],
            label: language === 'it' ? 'Paziente attuale' : 'Current patient'
        };
    }

    if (input.age_years < 2) {
        return {
            terms: ['infant', 'neonate', 'newborn', 'toddler', 'lattante', 'neonato', 'bambino piccolo'],
            label: language === 'it' ? 'Paziente attuale · lattante' : 'Current patient · infant'
        };
    }

    if (input.age_years < 12) {
        return {
            terms: ['child', 'children', 'pediatric', 'paediatric', 'pediatr', 'bambino', 'bambini', 'childhood'],
            label: language === 'it' ? 'Paziente attuale · bambino' : 'Current patient · child'
        };
    }

    if (input.age_years < 18) {
        return {
            terms: ['adolescent', 'teen', 'teenager', 'pediatric', 'paediatric', 'adolesc', 'ragazzo'],
            label: language === 'it' ? 'Paziente attuale · adolescente' : 'Current patient · adolescent'
        };
    }

    if (input.age_years >= 65) {
        return {
            terms: ['adult', 'older adult', 'elderly', 'geriatric', 'senior', 'adulto', 'anziano'],
            label: language === 'it' ? 'Paziente attuale · adulto/anziano' : 'Current patient · adult/older adult'
        };
    }

    return {
        terms: ['adult', 'adults', 'adulto'],
        label: language === 'it' ? 'Paziente attuale · adulto' : 'Current patient · adult'
    };
};

const extractMgKgRange = (value: string) => {
    const normalized = value.toLowerCase();
    const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*mg\s*\/?\s*kg/);
    if (rangeMatch) {
        return {
            min: Number(rangeMatch[1]),
            max: Number(rangeMatch[2])
        };
    }

    const singleMatch = normalized.match(/(\d+(?:\.\d+)?)\s*mg\s*\/?\s*kg/);
    if (singleMatch) {
        const dose = Number(singleMatch[1]);
        return { min: dose, max: dose };
    }

    return null;
};

const buildPatientSpecificDoseRow = (
    input: { age_years?: number; weight_kg?: number; language: string },
    row?: MedicationDoseRow
): MedicationDoseRow | null => {
    if (typeof input.age_years !== 'number' && typeof input.weight_kg !== 'number') return null;

    const isItalian = input.language?.toLowerCase().startsWith('it');
    const profileBits = [
        typeof input.age_years === 'number' ? `${input.age_years} ${isItalian ? 'anni' : 'years'}` : null,
        typeof input.weight_kg === 'number' ? `${input.weight_kg} kg` : null
    ].filter(Boolean);

    let dose = isItalian ? 'Verifica la riga più pertinente sotto.' : 'Check the most relevant row below.';
    let notes = isItalian
        ? 'Profilo paziente corrente, usato per evidenziare la fascia più vicina.'
        : 'Current patient profile, used to surface the closest dosing row.';

    if (row && typeof input.weight_kg === 'number') {
        const parsed = extractMgKgRange(`${row.dose} ${row.notes}`);
        if (parsed) {
            const min = Math.round(parsed.min * input.weight_kg);
            const max = Math.round(parsed.max * input.weight_kg);
            dose =
                min === max
                    ? `${min} mg`
                    : `${min}-${max} mg`;
            notes = isItalian
                ? `Range calcolato da ${parsed.min}${parsed.min === parsed.max ? '' : `-${parsed.max}`} mg/kg usando ${input.weight_kg} kg. Solo riferimento informativo.`
                : `Range calculated from ${parsed.min}${parsed.min === parsed.max ? '' : `-${parsed.max}`} mg/kg using ${input.weight_kg} kg. Informational reference only.`;
        }
    }

    return {
        population: `${getMedicationAudienceTerms(input).label}${profileBits.length ? ` · ${profileBits.join(' · ')}` : ''}`,
        dose,
        notes
    };
};

const refineDosageTable = (
    input: { age_years?: number; weight_kg?: number; language: string },
    rows: MedicationDoseRow[] | undefined
) => {
    const normalizedRows = Array.isArray(rows)
        ? rows.filter((row) => row?.population || row?.dose || row?.notes)
        : [];
    if (normalizedRows.length === 0) return normalizedRows;

    const audience = getMedicationAudienceTerms(input);

    const scored = normalizedRows.map((row) => {
        const haystack = `${row.population} ${row.dose} ${row.notes}`.toLowerCase();
        let score = 0;

        for (const term of audience.terms) {
            if (haystack.includes(term)) score += 5;
        }

        if (typeof input.weight_kg === 'number' && /mg\s*\/?\s*kg/.test(haystack)) score += 3;
        if (typeof input.age_years === 'number' && /adult|child|pediatric|paediatric|infant|adolescent|elderly|geriatric|adulto|bambin|anzian/.test(haystack)) score += 2;
        if (/general|all patients|tutti|usual|standard/.test(haystack)) score -= 1;

        return { row, score };
    });

    const ordered = scored.sort((a, b) => b.score - a.score).map((item) => item.row);
    const trimmed = ordered.slice(0, Math.min(4, ordered.length));
    const contextRow = buildPatientSpecificDoseRow(input, trimmed[0]);

    return contextRow ? [contextRow, ...trimmed] : trimmed;
};

const protocolLabels: Record<string, string> = {
    generic: 'Generic standard (5-level)',
    italy: 'Italian standard',
    home: 'Home care guide'
};

const resolveDestinationCode = (urgencyLevel: string) => {
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

export const runOrchestrationPipeline = async (
    rawInput: string,
    protocol: string,
    demographics: Record<string, unknown> = {},
    painScore = 0,
    onset = 'unknown',
    attachments: Array<{ name: string; type: string; base64: string }> = []
): Promise<AIResult> => {
    const auditTrail: AIResult['audit_trail'] = [];
    const intakeContext = { raw_input: rawInput, demographics, pain_score: painScore, onset };

    const normOutput = parseJSON<{ normalized_text: string; possible_primary_complaint: string; language_guess: string }>(
        await invokeNovaLite(INTAKE_NORMALIZER_PROMPT, JSON.stringify(intakeContext))
    );
    auditTrail.push({ step: 'normalize_intake', status: 'completed', summary: 'Raw intake normalized for downstream clinical extraction.' });

    const structContext = { ...normOutput, demographics };
    const structOutput = parseJSON<Record<string, unknown>>(
        await invokeNovaLite(SYMPTOM_STRUCTURER_PROMPT, JSON.stringify(structContext))
    );
    auditTrail.push({ step: 'structure_symptoms', status: 'completed', summary: 'Symptoms converted into structured clinical fields.' });

    const safetyOutput = evaluateSafetyRules({
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
        summary:
            safetyOutput.rules_triggered.length > 0
                ? `Deterministic safety rules triggered: ${safetyOutput.rules_triggered.join(', ')}.`
                : 'No deterministic safety rule override was triggered.'
    });

    let multimodalOutput = { extracted_findings: [] as string[], clinical_relevance: 'none' };
    if (attachments.length > 0) {
        multimodalOutput = parseJSON<{ extracted_findings: string[]; clinical_relevance: string }>(
            await invokeNovaMultimodal(
                process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0',
                MULTIMODAL_EXTRACTOR_PROMPT,
                JSON.stringify({ context: structOutput, demographics }),
                attachments
            )
        );
        auditTrail.push({
            step: 'multimodal_extraction',
            status: 'completed',
            summary: `Processed ${attachments.length} attachment(s) for clinical findings.`
        });
    } else {
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
    const riskOutput = parseJSON<{
        urgency_level: AIResult['urgency_level'];
        confidence: number;
        risk_factors: string[];
        reasoning_summary: string[];
    }>(await invokeNovaLite(RISK_CLASSIFIER_PROMPT, JSON.stringify(riskContext)));
    auditTrail.push({ step: 'risk_classification', status: 'completed', summary: `Model classified urgency as ${riskOutput.urgency_level}.` });

    const finalUrgency = safetyOutput.minimum_urgency
        ? getHigherUrgency(riskOutput.urgency_level, safetyOutput.minimum_urgency)
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

    const clusterOutput = parseJSON<{ clusters: any[] }>(
        await invokeNovaPro(DIFFERENTIAL_CLUSTER_PROMPT, JSON.stringify({ symptoms: structOutput, demographics }))
    );
    auditTrail.push({ step: 'differential_clusters', status: 'completed', summary: `Generated ${clusterOutput.clusters.length} possible cluster(s).` });

    const handoffContext = {
        symptoms: structOutput,
        risk: finalRisk,
        clusters: clusterOutput.clusters,
        demographics,
        multimodal: multimodalOutput,
        safety: safetyOutput
    };
    const handoffOutput = parseJSON<{ handoff_card_markdown: string }>(
        await invokeNovaPro(HANDOFF_COMPOSER_PROMPT, JSON.stringify(handoffContext))
    );
    auditTrail.push({ step: 'clinician_handoff', status: 'completed', summary: 'Generated clinician handoff summary.' });

    const patientOutput = parseJSON<{ patient_summary: string; next_steps: string[] }>(
        await invokeNovaLite(PATIENT_EXPLANATION_PROMPT, JSON.stringify(handoffContext))
    );
    auditTrail.push({ step: 'patient_summary', status: 'completed', summary: 'Generated patient-facing explanation and next steps.' });

    const suggestedDestinationCode = resolveDestinationCode(finalUrgency);

    return {
        urgency_level: finalUrgency,
        protocol_code: protocol,
        protocol_label: protocolLabels[protocol] || protocol,
        confidence: riskOutput.confidence,
        red_flags: mergedRedFlags,
        rules_triggered: safetyOutput.rules_triggered,
        safety_escalation_applied: Boolean(
            safetyOutput.minimum_urgency && safetyOutput.minimum_urgency !== riskOutput.urgency_level
        ),
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

export const runReportAnalysis = async (
    text: string,
    language: string,
    attachments: Array<{ name: string; type: string; base64: string }> = []
) => {
    const payload = JSON.stringify({ text, language });

    if (attachments.length > 0) {
        const result = parseJSON<{
            summary: string;
            key_findings: string[];
            attention_points: Array<{ label: string; severity: 'high' | 'moderate' | 'low' }> | string[];
            suggested_follow_up: string[];
            reassuring_elements: string[];
            disclaimer: string;
            confidence: number;
        }>(
            await invokeNovaMultimodal(
                process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0',
                REPORT_ANALYSIS_PROMPT,
                payload,
                attachments
            )
        );
        return {
            ...result,
            attention_points: normalizeAttentionPoints(result.attention_points)
        };
    }

    const result = parseJSON<{
        summary: string;
        key_findings: string[];
        attention_points: Array<{ label: string; severity: 'high' | 'moderate' | 'low' }> | string[];
        suggested_follow_up: string[];
        reassuring_elements: string[];
        disclaimer: string;
        confidence: number;
    }>(await invokeNovaPro(REPORT_ANALYSIS_PROMPT, payload));
    return {
        ...result,
        attention_points: normalizeAttentionPoints(result.attention_points)
    };
};

export const runMedicationLookup = async (input: {
    medication_name: string;
    indication?: string;
    age_years?: number;
    weight_kg?: number;
    question?: string;
    language: string;
}) => {
    const result = parseJSON<{
        generic_name: string;
        therapeutic_class: string;
        summary: string;
        main_uses: string[];
        main_contraindications: string[];
        common_side_effects: string[];
        interaction_alerts: string[];
        dosage_table: Array<{ population: string; dose: string; notes: string }>;
        chat_answer: string;
        guardrails?: string[];
        disclaimer: string;
    }>(await invokeNovaPro(MEDICATION_OVERVIEW_PROMPT, JSON.stringify(input)));
    return {
        ...result,
        dosage_table: refineDosageTable(input, result.dosage_table),
        guardrails: result.guardrails?.length ? result.guardrails : buildMedicationGuardrails(input),
        disclaimer:
            result.disclaimer ||
            (input.language?.toLowerCase().startsWith('it')
                ? 'Supporto informativo soltanto. Verificare sempre con foglietto illustrativo, farmacista o medico.'
                : 'Informational support only. Always verify with the official leaflet, pharmacist, or clinician.')
    };
};
