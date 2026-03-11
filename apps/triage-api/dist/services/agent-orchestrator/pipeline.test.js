"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pipeline_1 = require("./pipeline");
const bedrock = __importStar(require("../nova-clients/bedrock"));
const bedrock_mock_builder_1 = require("../../tests/utils/bedrock-mock-builder");
// Mock the bedrock clients so we don't need real AWS credentials
vitest_1.vi.mock('../nova-clients/bedrock', () => ({
    invokeNovaLite: vitest_1.vi.fn(),
    invokeNovaPro: vitest_1.vi.fn(),
    invokeNovaMultimodal: vitest_1.vi.fn(),
}));
(0, vitest_1.describe)('Agent Orchestrator Pipeline', () => {
    (0, vitest_1.it)('should process input and return an AI result matching the schema', async () => {
        // Use externalized mock builder to contextualize the test
        (0, bedrock_mock_builder_1.setupPipelineBedrockMocks)(bedrock);
        const result = await (0, pipeline_1.runOrchestrationPipeline)('my chest hurts really bad', 'generic', {}, 8, 'sudden');
        (0, vitest_1.expect)(result).toBeDefined();
        (0, vitest_1.expect)(result.urgency_level).toBe('critical');
        (0, vitest_1.expect)(result.protocol_code).toBe('generic');
        (0, vitest_1.expect)(result.suggested_destination_code).toBe('ambulance');
        (0, vitest_1.expect)(result.patient_summary).toContain('immediate');
        (0, vitest_1.expect)(result.handoff_card_markdown).toContain('FastTrack');
        (0, vitest_1.expect)(result.rules_triggered).toContain('severe_chest_pain_sudden_onset');
        (0, vitest_1.expect)(result.safety_escalation_applied).toBe(false);
        (0, vitest_1.expect)(result.audit_trail.length).toBeGreaterThan(0);
        // Verify it called Bedrock functions
        (0, vitest_1.expect)(bedrock.invokeNovaLite).toHaveBeenCalledTimes(4);
        (0, vitest_1.expect)(bedrock.invokeNovaPro).toHaveBeenCalledTimes(2);
    });
});
