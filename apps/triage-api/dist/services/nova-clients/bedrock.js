"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeNovaMultimodal = exports.invokeNovaSonic = exports.invokeNovaPro = exports.invokeNovaLite = void 0;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client = new client_bedrock_runtime_1.BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
const invokeNovaLite = async (system, prompt) => {
    const modelId = process.env.BEDROCK_NOVA_LITE_MODEL || 'us.amazon.nova-lite-v1:0';
    return invokeNovaText(modelId, system, prompt);
};
exports.invokeNovaLite = invokeNovaLite;
const invokeNovaPro = async (system, prompt) => {
    const modelId = process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0';
    return invokeNovaText(modelId, system, prompt);
};
exports.invokeNovaPro = invokeNovaPro;
const invokeNovaSonic = async (system, audioBase64) => {
    // Nova Micro / Sonic are often used for speech
    const modelId = process.env.BEDROCK_NOVA_SONIC_MODEL || 'us.amazon.nova-micro-v1:0';
    const message = {
        role: "user",
        content: [
            { text: "Transcribe the following audio accurately, ignoring filler noises." },
            { audio: { format: "webm", source: { bytes: Buffer.from(audioBase64, 'base64') } } }
        ]
    };
    return invokeNovaConverse(modelId, system, [message]);
};
exports.invokeNovaSonic = invokeNovaSonic;
const invokeNovaMultimodal = async (modelId, system, text, attachments) => {
    // Convert generic attachments to Converse blocks
    const contentBlocks = [{ text }];
    for (const att of attachments) {
        const buffer = Buffer.from(att.base64, 'base64');
        const ext = att.name.split('.').pop()?.toLowerCase();
        if (att.type.startsWith('image/') || ['png', 'jpeg', 'webp', 'gif'].includes(ext || '')) {
            contentBlocks.push({
                image: {
                    format: ext === 'jpg' ? 'jpeg' : (ext || 'png'),
                    source: { bytes: buffer }
                }
            });
        }
        else if (att.type === 'application/pdf' || ext === 'pdf') {
            contentBlocks.push({
                document: {
                    name: att.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10),
                    format: 'pdf',
                    source: { bytes: buffer }
                }
            });
        }
    }
    const message = {
        role: "user",
        content: contentBlocks
    };
    return invokeNovaConverse(modelId, system, [message]);
};
exports.invokeNovaMultimodal = invokeNovaMultimodal;
// Backwards compatible Text-only invocation
const invokeNovaText = async (modelId, system, prompt) => {
    const message = {
        role: "user",
        content: [{ text: prompt }]
    };
    return invokeNovaConverse(modelId, system, [message]);
};
// Core wrapper using the generic Converse API (Standard for Amazon Nova)
const invokeNovaConverse = async (modelId, system, messages) => {
    const command = new client_bedrock_runtime_1.ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages,
        inferenceConfig: { maxTokens: 1000, topP: 0.9, temperature: 0.1 }
    });
    try {
        const response = await client.send(command);
        if (response.output?.message?.content && response.output.message.content.length > 0) {
            return response.output.message.content[0].text || "{}";
        }
        return "{}";
    }
    catch (e) {
        console.error("ConverseCommand Error:", e);
        throw new Error(`Bedrock Converse API failed: \${e.message}`);
    }
};
