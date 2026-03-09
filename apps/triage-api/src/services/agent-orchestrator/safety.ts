import type { AIResult } from 'shared-types';

type UrgencyLevel = AIResult['urgency_level'];

export interface SafetyRuleInput {
    rawInput: string;
    normalizedText: string;
    structuredSymptoms: Record<string, unknown>;
    demographics: Record<string, unknown>;
    painScore: number;
    onset: string;
}

export interface SafetyRuleResult {
    rules_triggered: string[];
    critical_red_flags: string[];
    minimum_urgency: UrgencyLevel | null;
    missing_information: string[];
    clarification_questions: string[];
    deterministic_notes: string[];
}

const urgencyRank: Record<UrgencyLevel, number> = {
    minimal: 0,
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4
};

const asLowerText = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

const asStringArray = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const hasAny = (haystack: string, terms: string[]) => terms.some((term) => haystack.includes(term));

const hasTermsInCollections = (collections: string[], terms: string[]) =>
    collections.some((entry) => hasAny(entry.toLowerCase(), terms));

const mergeMinimumUrgency = (current: UrgencyLevel | null, next: UrgencyLevel): UrgencyLevel =>
    !current || urgencyRank[next] > urgencyRank[current] ? next : current;

export const getHigherUrgency = (left: UrgencyLevel, right: UrgencyLevel): UrgencyLevel =>
    urgencyRank[left] >= urgencyRank[right] ? left : right;

export const evaluateSafetyRules = (input: SafetyRuleInput): SafetyRuleResult => {
    const allNarrative = [input.rawInput, input.normalizedText, input.onset].filter(Boolean).join(' ').toLowerCase();
    const chiefComplaint = asLowerText(input.structuredSymptoms.chief_complaint);
    const symptoms = asStringArray(input.structuredSymptoms.symptoms).map((item) => item.toLowerCase());
    const associatedSymptoms = asStringArray(input.structuredSymptoms.associated_symptoms).map((item) => item.toLowerCase());
    const knownConditions = asStringArray(input.structuredSymptoms.known_conditions_mentioned).map((item) => item.toLowerCase());
    const medicationMentions = asStringArray(input.structuredSymptoms.medications_mentioned).map((item) => item.toLowerCase());
    const searchable = [allNarrative, chiefComplaint, ...symptoms, ...associatedSymptoms, ...knownConditions, ...medicationMentions].join(' ');

    const ageBand = asLowerText(input.demographics.ageBand || input.demographics.age_band);
    const frailty = Boolean(input.demographics.frailty || input.demographics.clinical_frailty);

    const result: SafetyRuleResult = {
        rules_triggered: [],
        critical_red_flags: [],
        minimum_urgency: null,
        missing_information: [],
        clarification_questions: [],
        deterministic_notes: []
    };

    const trigger = (ruleId: string, urgency: UrgencyLevel, redFlag: string, note: string) => {
        result.rules_triggered.push(ruleId);
        result.critical_red_flags.push(redFlag);
        result.minimum_urgency = mergeMinimumUrgency(result.minimum_urgency, urgency);
        result.deterministic_notes.push(note);
    };

    if (
        (hasAny(searchable, ['chest pain', 'dolore toracico', 'tight chest', 'chest pressure']) &&
            (input.painScore >= 7 || hasAny(searchable, ['severe', 'forte', 'oppressive', 'sudden onset', 'improvvisa']))) ||
        (hasAny(searchable, ['chest pain', 'dolore toracico']) && asLowerText(input.onset) === 'sudden')
    ) {
        trigger(
            'severe_chest_pain_sudden_onset',
            'critical',
            'Severe chest pain with sudden onset',
            'Deterministic override applied for severe chest pain with sudden onset.'
        );
        if (!hasTermsInCollections([...associatedSymptoms, searchable], ['shortness of breath', 'sweating', 'radiating', 'nausea'])) {
            result.missing_information.push('Associated symptoms for chest pain are incomplete.');
            result.clarification_questions.push('Is the chest pain associated with shortness of breath, sweating, nausea, or radiation to arm/jaw?');
        }
    }

    if (hasAny(searchable, ['shortness of breath', 'breathless', 'dispnea', 'can’t breathe', 'cannot breathe', 'fatica respiratoria'])) {
        const severeResp = input.painScore >= 7 || hasAny(searchable, ['severe', 'grave', 'blue lips', 'cyanosis', 'cannot speak', 'wheezing']);
        if (severeResp) {
            trigger(
                'severe_dyspnea',
                'critical',
                'Severe shortness of breath',
                'Deterministic override applied for severe respiratory distress.'
            );
        } else {
            trigger(
                'dyspnea_requires_urgent_assessment',
                'high',
                'Shortness of breath requires urgent assessment',
                'Deterministic escalation applied for respiratory symptoms.'
            );
        }
    }

    if (hasAny(searchable, ['stroke', 'facial droop', 'slurred speech', 'weakness', 'numbness', 'one-sided', 'hemiparesis', 'confusion improvvisa'])) {
        trigger(
            'possible_stroke',
            'critical',
            'Stroke-compatible neurologic symptoms',
            'Deterministic override applied for possible stroke pattern.'
        );
        result.clarification_questions.push('When did the neurologic symptoms start, and is one side of the body weaker or numb?');
    }

    if (hasAny(searchable, ['altered mental status', 'confused', 'not responding', 'lethargic', 'difficult to wake', 'confusione', 'disorientato'])) {
        trigger(
            'altered_mental_status',
            'critical',
            'Altered mental status',
            'Deterministic override applied for altered mental status.'
        );
    }

    if (hasAny(searchable, ['anaphylaxis', 'swollen tongue', 'swollen lips', 'hives', 'urticaria', 'allergic reaction', 'reazione allergica'])) {
        trigger(
            'suspected_anaphylaxis',
            'critical',
            'Possible anaphylaxis',
            'Deterministic override applied for suspected anaphylaxis.'
        );
    }

    if (hasAny(searchable, ['bleeding heavily', 'heavy bleeding', 'emorragia', 'hemorrhage', 'blood everywhere', 'vomiting blood', 'coughing blood'])) {
        trigger(
            'major_hemorrhage',
            'critical',
            'Major bleeding reported',
            'Deterministic override applied for major hemorrhage.'
        );
    }

    if (hasAny(searchable, ['fever', 'febbre', '39', '40', '104']) && (ageBand === '0-1' || frailty)) {
        trigger(
            'high_fever_fragile_patient',
            'high',
            'High fever in infant or frail patient',
            'Deterministic escalation applied for fever in fragile patient.'
        );
        result.clarification_questions.push('What is the highest measured temperature, and how long has the fever been present?');
    }

    if (result.rules_triggered.length === 0 && hasAny(searchable, ['pain', 'dolore']) && !input.onset) {
        result.missing_information.push('Symptom onset is missing.');
        result.clarification_questions.push('When did the symptoms start, and are they getting worse?');
    }

    result.rules_triggered = Array.from(new Set(result.rules_triggered));
    result.critical_red_flags = Array.from(new Set(result.critical_red_flags));
    result.missing_information = Array.from(new Set(result.missing_information));
    result.clarification_questions = Array.from(new Set(result.clarification_questions)).slice(0, 3);
    result.deterministic_notes = Array.from(new Set(result.deterministic_notes));

    return result;
};
