"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPipelineBedrockMocks = void 0;
const setupPipelineBedrockMocks = (bedrockMock) => {
    bedrockMock.invokeNovaLite
        .mockResolvedValueOnce(JSON.stringify({
        normalized_text: 'patient has chest pain',
        possible_primary_complaint: 'chest pain',
        language_guess: 'en'
    }))
        .mockResolvedValueOnce(JSON.stringify({
        chief_complaint: 'chest pain',
        onset: '10 minutes ago',
        duration: '10 min',
        pain_score: 8,
        symptoms: ['chest pain'],
        associated_symptoms: [],
        aggravating_factors: [],
        relieving_factors: [],
        known_conditions_mentioned: [],
        medications_mentioned: []
    }))
        .mockResolvedValueOnce(JSON.stringify({
        urgency_level: 'critical',
        confidence: 0.95,
        risk_factors: ['chest pain', 'sudden onset'],
        reasoning_summary: ['High risk of ACS']
    }))
        .mockResolvedValueOnce(JSON.stringify({
        patient_summary: 'You have severe chest pain and need immediate medical attention.',
        next_steps: ['Call 911'],
        emergency_warning: true
    }));
    bedrockMock.invokeNovaPro
        .mockResolvedValueOnce(JSON.stringify({
        clusters: [
            {
                label: 'Acute Coronary Syndrome',
                score: 0.9,
                supporting_factors: ['chest pain'],
                against_factors: []
            }
        ]
    }))
        .mockResolvedValueOnce(JSON.stringify({
        handoff_card_markdown: '# FastTrack Handoff\n\n- Patient: Unknown\n- Chief Complaint: Chest Pain\n- Urgency: CRITICAL'
    }));
};
exports.setupPipelineBedrockMocks = setupPipelineBedrockMocks;
