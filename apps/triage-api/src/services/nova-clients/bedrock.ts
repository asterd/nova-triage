import { BedrockRuntimeClient, ConverseCommand, Message } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

export const invokeNovaLite = async (system: string, prompt: string) => {
    const modelId = process.env.BEDROCK_NOVA_LITE_MODEL || 'us.amazon.nova-lite-v1:0';
    return invokeNovaText(modelId, system, prompt);
};

export const invokeNovaPro = async (system: string, prompt: string) => {
    const modelId = process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0';
    return invokeNovaText(modelId, system, prompt);
};

export const invokeNovaSonic = async (system: string, audioBase64: string) => {
    // Nova Micro / Sonic are often used for speech
    const modelId = process.env.BEDROCK_NOVA_SONIC_MODEL || 'us.amazon.nova-micro-v1:0';

    const message: Message = {
        role: "user",
        content: [
            { text: "Transcribe the following audio accurately, ignoring filler noises." },
            { audio: { format: "webm", source: { bytes: Buffer.from(audioBase64, 'base64') } } }
        ]
    };

    return invokeNovaConverse(modelId, system, [message]);
};

export const invokeNovaMultimodal = async (modelId: string, system: string, text: string, attachments: { name: string, type: string, base64: string }[]) => {
    const inlineTextAttachments: string[] = [];
    const contentBlocks: any[] = [{ text }];

    for (const att of attachments) {
        const buffer = Buffer.from(att.base64, 'base64');
        const ext = att.name.split('.').pop()?.toLowerCase();
        const normalizedType = (att.type || '').toLowerCase();

        if (att.type.startsWith('image/') || ['png', 'jpeg', 'webp', 'gif'].includes(ext || '')) {
            contentBlocks.push({
                image: {
                    format: ext === 'jpg' ? 'jpeg' : (ext || 'png'),
                    source: { bytes: buffer }
                }
            });
        } else if (normalizedType === 'application/pdf' || ext === 'pdf') {
            contentBlocks.push({
                document: {
                    name: att.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10),
                    format: 'pdf',
                    source: { bytes: buffer }
                }
            });
        } else if (normalizedType.startsWith('text/') || normalizedType === 'application/json' || normalizedType === 'application/xml') {
            inlineTextAttachments.push(buffer.toString('utf8'));
        }
    }

    if (inlineTextAttachments.length > 0) {
        contentBlocks[0] = {
            text: `${text}\n\nRedacted text attachments:\n${inlineTextAttachments
                .map((item, index) => `Attachment ${index + 1}:\n${item}`)
                .join('\n\n')}`
        };
    }

    const message: Message = {
        role: "user",
        content: contentBlocks
    };

    return invokeNovaConverse(modelId, system, [message]);
};

// Backwards compatible Text-only invocation
const invokeNovaText = async (modelId: string, system: string, prompt: string) => {
    const message: Message = {
        role: "user",
        content: [{ text: prompt }]
    };
    return invokeNovaConverse(modelId, system, [message]);
};

// Core wrapper using the generic Converse API (Standard for Amazon Nova)
const invokeNovaConverse = async (modelId: string, system: string, messages: Message[]) => {
    const command = new ConverseCommand({
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
    } catch (e: any) {
        console.error("ConverseCommand Error:", e);
        throw new Error(`Bedrock Converse API failed: ${e.message}`);
    }
};
