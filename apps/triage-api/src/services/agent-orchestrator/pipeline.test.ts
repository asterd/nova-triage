import { describe, it, expect, vi } from 'vitest';
import { runOrchestrationPipeline } from './pipeline';
import * as bedrock from '../nova-clients/bedrock';

// Mock the bedrock clients so we don't need real AWS credentials
vi.mock('../nova-clients/bedrock', () => ({
    invokeNovaLite: vi.fn(),
    invokeNovaPro: vi.fn(),
    invokeNovaMultimodal: vi.fn(),
}));

describe('Agent Orchestrator Pipeline', () => {
    it('should process input and return an AI result matching the schema', async () => {
        // Mock sequential bedrock calls
        vi.mocked(bedrock.invokeNovaLite)
            .mockResolvedValueOnce(JSON.stringify({
                normalized_text: 'patient has chest pain',
                possible_primary_complaint: 'chest pain',
                language_guess: 'en'
            })) // 1. normalizer
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
            })) // 2. structurer
            .mockResolvedValueOnce(JSON.stringify({
                urgency_level: 'critical',
                confidence: 0.95,
                risk_factors: ['chest pain', 'sudden onset'],
                reasoning_summary: ['High risk of ACS']
            })) // 4. risk classifier
            .mockResolvedValueOnce(JSON.stringify({
                patient_summary: 'You have severe chest pain and need immediate medical attention.',
                next_steps: ['Call 911'],
                emergency_warning: true
            })); // 7. patient explanation

        vi.mocked(bedrock.invokeNovaPro)
            .mockResolvedValueOnce(JSON.stringify({
                clusters: [
                    {
                        label: 'Acute Coronary Syndrome',
                        score: 0.9,
                        supporting_factors: ['chest pain'],
                        against_factors: []
                    }
                ]
            })) // 5. differential
            .mockResolvedValueOnce(JSON.stringify({
                handoff_card_markdown: '# FastTrack Handoff\n\n- Patient: Unknown\n- Chief Complaint: Chest Pain\n- Urgency: CRITICAL'
            })); // 6. handoff composer

        const result = await runOrchestrationPipeline('my chest hurts really bad', 'generic', {}, 8, 'sudden');

        expect(result).toBeDefined();
        expect(result.urgency_level).toBe('critical');
        expect(result.protocol_code).toBe('generic');
        expect(result.suggested_destination_code).toBe('ambulance');
        expect(result.patient_summary).toContain('immediate');
        expect(result.handoff_card_markdown).toContain('FastTrack');
        expect(result.rules_triggered).toContain('severe_chest_pain_sudden_onset');
        expect(result.safety_escalation_applied).toBe(false);
        expect(result.audit_trail.length).toBeGreaterThan(0);

        // Verify it called Bedrock functions
        expect(bedrock.invokeNovaLite).toHaveBeenCalledTimes(4);
        expect(bedrock.invokeNovaPro).toHaveBeenCalledTimes(2);
    });
});
