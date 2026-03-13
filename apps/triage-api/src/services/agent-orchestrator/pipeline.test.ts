import { describe, it, expect, vi } from 'vitest';
import { runOrchestrationPipeline } from './pipeline';
import * as bedrock from '../nova-clients/bedrock';
import { setupPipelineBedrockMocks } from '../../tests/utils/bedrock-mock-builder';

// Mock the bedrock clients so we don't need real AWS credentials
vi.mock('../nova-clients/bedrock', () => ({
    invokeNovaLite: vi.fn(),
    invokeNovaPro: vi.fn(),
    invokeNovaMultimodal: vi.fn(),
}));

describe('Agent Orchestrator Pipeline', () => {
    it('should process input and return an AI result matching the schema', async () => {
        // Use externalized mock builder to contextualize the test
        setupPipelineBedrockMocks(bedrock);

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

    it('should recover from lightly malformed JSON returned by the model', async () => {
        (bedrock.invokeNovaLite as any)
            .mockResolvedValueOnce('```json\n{"normalized_text":"patient has chest pain","possible_primary_complaint":"chest pain","language_guess":"en"}\n```')
            .mockResolvedValueOnce('{"chief_complaint":"chest pain","onset":"10 minutes ago","duration":"10 min","pain_score":8,"symptoms":["chest pain"],"associated_symptoms":[],"aggravating_factors":[],"relieving_factors":[],"known_conditions_mentioned":[],"medications_mentioned":[]}')
            .mockResolvedValueOnce('{urgency_level:"critical",confidence:0.95,risk_factors:["chest pain"],reasoning_summary:["High risk of ACS"],}')
            .mockResolvedValueOnce('{"patient_summary":"Seek urgent care now.","next_steps":["Call emergency services"]}');

        (bedrock.invokeNovaPro as any)
            .mockResolvedValueOnce('{"clusters":[{"label":"Acute Coronary Syndrome","score":0.9,"supporting_factors":["chest pain"],"against_factors":[]}]}')
            .mockResolvedValueOnce('{"handoff_card_markdown":"# FastTrack Handoff"}');

        const result = await runOrchestrationPipeline('my chest hurts really bad', 'generic', {}, 8, 'sudden');

        expect(result.urgency_level).toBe('critical');
        expect(result.reasoning_summary).toContain('High risk of ACS');
        expect(result.handoff_card_markdown).toContain('FastTrack');
    });
});
