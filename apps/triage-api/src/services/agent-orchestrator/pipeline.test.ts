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
});
