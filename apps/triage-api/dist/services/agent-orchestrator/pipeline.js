"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOrchestrationPipeline = void 0;
const bedrock_1 = require("../nova-clients/bedrock");
const prompts_1 = require("prompts");
const cleanJSON = (str) => {
    return str.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
};
const runOrchestrationPipeline = async (rawInput, protocol, demographics = {}, painScore = 0, onset = 'unknown', attachments = []) => {
    // 1. Intake Normalizer (Nova Lite)
    const normStr = await (0, bedrock_1.invokeNovaLite)(prompts_1.INTAKE_NORMALIZER_PROMPT, JSON.stringify({ raw_input: rawInput, demographics, pain_score: painScore, onset }));
    const normOutput = JSON.parse(cleanJSON(normStr));
    // 2. Symptom Structurer (Nova Lite)
    const structStr = await (0, bedrock_1.invokeNovaLite)(prompts_1.SYMPTOM_STRUCTURER_PROMPT, JSON.stringify(normOutput));
    const structOutput = JSON.parse(cleanJSON(structStr));
    // 2.5 Multimodal Extractor (Nova Pro via Converse)
    let multimodalOutput = { extracted_findings: [], clinical_relevance: "none" };
    if (attachments && attachments.length > 0) {
        const mmContext = JSON.stringify({ context: structOutput });
        const mmStr = await (0, bedrock_1.invokeNovaMultimodal)(process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0', prompts_1.MULTIMODAL_EXTRACTOR_PROMPT, mmContext, attachments);
        multimodalOutput = JSON.parse(cleanJSON(mmStr));
    }
    // 3. Safety Rules Engine (Deterministic - Mocked for now)
    const rulesOutput = { critical_red_flags: [], rules_triggered: [] };
    // 4. Risk Classifier (Nova Lite)
    const riskContext = { symptoms: structOutput, rules: rulesOutput, findings: multimodalOutput.extracted_findings };
    const riskStr = await (0, bedrock_1.invokeNovaLite)(prompts_1.RISK_CLASSIFIER_PROMPT, JSON.stringify(riskContext));
    const riskOutput = JSON.parse(cleanJSON(riskStr));
    // 5. Differential Clusters (Nova Pro)
    const clusterStr = await (0, bedrock_1.invokeNovaPro)(prompts_1.DIFFERENTIAL_CLUSTER_PROMPT, JSON.stringify(structOutput));
    const clusterOutput = JSON.parse(cleanJSON(clusterStr));
    // 6. Handoff Composer (Nova Pro)
    const handoffContext = { symptoms: structOutput, risk: riskOutput, clusters: clusterOutput.clusters, demographics };
    const handoffStr = await (0, bedrock_1.invokeNovaPro)(prompts_1.HANDOFF_COMPOSER_PROMPT, JSON.stringify(handoffContext));
    const handoffOutput = JSON.parse(cleanJSON(handoffStr));
    // 7. Patient Explanation (Nova Lite)
    const patientStr = await (0, bedrock_1.invokeNovaLite)(prompts_1.PATIENT_EXPLANATION_PROMPT, JSON.stringify(handoffContext));
    const patientOutput = JSON.parse(cleanJSON(patientStr));
    // Assemble Result
    return {
        urgency_level: riskOutput.urgency_level,
        protocol_label: `${riskOutput.urgency_level.toUpperCase()} [${protocol}]`,
        confidence: riskOutput.confidence,
        red_flags: riskOutput.risk_factors,
        possible_clusters: clusterOutput.clusters,
        reasoning_summary: riskOutput.reasoning_summary,
        suggested_destination: "Urgent Care",
        missing_information: [],
        handoff_card_markdown: handoffOutput.handoff_card_markdown,
        patient_summary: patientOutput.patient_summary,
        next_steps: patientOutput.next_steps
    };
};
exports.runOrchestrationPipeline = runOrchestrationPipeline;
