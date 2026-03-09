import { BedrockRuntimeClient, ConverseCommand, InvokeModelWithBidirectionalStreamCommand, Message } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';

const clientCache = new Map<string, BedrockRuntimeClient>();

const getBedrockClient = (region: string) => {
    if (!clientCache.has(region)) {
        clientCache.set(region, new BedrockRuntimeClient({
            region,
            requestHandler: new NodeHttp2Handler({
                requestTimeout: 300000,
                sessionTimeout: 300000,
                disableConcurrentStreams: false,
                maxConcurrentStreams: 20
            })
        }));
    }
    return clientCache.get(region)!;
};

const defaultRegion = process.env.AWS_REGION || 'us-east-1';

export const invokeNovaLite = async (system: string, prompt: string) => {
    const modelId = process.env.BEDROCK_NOVA_LITE_MODEL || 'us.amazon.nova-lite-v1:0';
    return invokeNovaText(modelId, system, prompt);
};

export const invokeNovaPro = async (system: string, prompt: string) => {
    const modelId = process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0';
    return invokeNovaText(modelId, system, prompt);
};

const DEFAULT_SONIC_MODEL = 'amazon.nova-sonic-v1:0';

type SonicTranscriptOptions = {
    sampleRateHertz?: number;
    prompt?: string;
};

const encodeSonicEvent = (event: Record<string, unknown>) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify(event), 'utf8')
    }
});

async function* buildSonicInputStream(audioBytes: Uint8Array, systemPrompt: string, sampleRateHertz: number, prompt: string) {
    yield encodeSonicEvent({
        event: {
            sessionStart: {
                inferenceConfiguration: {
                    maxTokens: 1024,
                    topP: 0.9,
                    temperature: 0
                }
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            promptStart: {
                promptName: 'transcribe_audio',
                textOutputConfiguration: { mediaType: 'text/plain' },
                audioOutputConfiguration: {
                    mediaType: 'audio/lpcm',
                    sampleRateHertz: 24000,
                    sampleSizeBits: 16,
                    channelCount: 1,
                    voiceId: 'matthew',
                    encoding: 'base64',
                    audioType: 'SPEECH'
                }
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentStart: {
                promptName: 'transcribe_audio',
                contentName: 'system_instruction',
                type: 'TEXT',
                role: 'SYSTEM',
                interactive: false,
                textInputConfiguration: {}
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            textInput: {
                promptName: 'transcribe_audio',
                contentName: 'system_instruction',
                content: systemPrompt
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName: 'transcribe_audio',
                contentName: 'system_instruction'
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentStart: {
                promptName: 'transcribe_audio',
                contentName: 'user_request',
                type: 'TEXT',
                role: 'USER',
                interactive: false,
                textInputConfiguration: {}
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            textInput: {
                promptName: 'transcribe_audio',
                contentName: 'user_request',
                content: prompt
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName: 'transcribe_audio',
                contentName: 'user_request'
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentStart: {
                promptName: 'transcribe_audio',
                contentName: 'patient_audio',
                type: 'AUDIO',
                role: 'USER',
                interactive: false,
                audioInputConfiguration: {
                    mediaType: 'audio/lpcm',
                    sampleRateHertz,
                    sampleSizeBits: 16,
                    channelCount: 1,
                    audioType: 'SPEECH'
                }
            }
        }
    });

    const chunkSize = sampleRateHertz * 2;
    for (let offset = 0; offset < audioBytes.length; offset += chunkSize) {
        const frame = audioBytes.slice(offset, Math.min(audioBytes.length, offset + chunkSize));
        yield encodeSonicEvent({
            event: {
                audioInput: {
                    promptName: 'transcribe_audio',
                    contentName: 'patient_audio',
                    content: Buffer.from(frame).toString('base64')
                }
            }
        });
    }

    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName: 'transcribe_audio',
                contentName: 'patient_audio'
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            promptEnd: {
                promptName: 'transcribe_audio'
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            sessionEnd: {}
        }
    });
}

export const invokeNovaSonic = async (system: string, audioBase64: string, options: SonicTranscriptOptions = {}) => {
    const rawModelId = process.env.BEDROCK_NOVA_SONIC_MODEL || DEFAULT_SONIC_MODEL;
    const modelId = rawModelId.replace(/^(?:[a-z]{2}\.)?amazon\./i, 'amazon.');
    const sonicRegion = process.env.BEDROCK_NOVA_SONIC_REGION || 'us-east-1';
    if (!/nova-sonic/i.test(modelId)) {
        throw new Error('BEDROCK_NOVA_SONIC_MODEL must target Amazon Nova Sonic, for example amazon.nova-sonic-v1:0.');
    }

    const sampleRateHertz = options.sampleRateHertz || 16000;
    const prompt = options.prompt || 'Transcribe the patient speech accurately. Return plain text only.';
    const audioBytes = Buffer.from(audioBase64, 'base64');

    if (audioBytes.length === 0) {
        throw new Error('Audio payload is empty.');
    }

    const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: buildSonicInputStream(audioBytes, system, sampleRateHertz, prompt),
    });
    command.middlewareStack.add(
        (next) => async (args) => {
            const request = args.request as any;
            if (request) {
                request.headers = {
                    ...(request.headers ?? {}),
                    'content-type': 'application/json',
                    'accept': 'application/json',
                };
            }
            return next(args);
        },
        { step: 'build', name: 'novaSonicContentTypeMiddleware', priority: 'high' }
    );

    try {
        const response = await getBedrockClient(sonicRegion).send(command);
        const transcriptParts: string[] = [];

        for await (const event of response.body ?? []) {
            if ('chunk' in event && event.chunk?.bytes) {
                const payloadText = Buffer.from(event.chunk.bytes).toString('utf8');
                const payload = JSON.parse(payloadText);
                const textOutput = payload?.event?.textOutput;
                if (textOutput?.role === 'USER' && typeof textOutput.content === 'string') {
                    transcriptParts.push(textOutput.content);
                }
                continue;
            }

            if ('validationException' in event && event.validationException?.message) {
                throw new Error(event.validationException.message);
            }
            if ('modelStreamErrorException' in event && event.modelStreamErrorException?.message) {
                throw new Error(event.modelStreamErrorException.message);
            }
            if ('internalServerException' in event && event.internalServerException?.message) {
                throw new Error(event.internalServerException.message);
            }
            if ('modelTimeoutException' in event && event.modelTimeoutException?.message) {
                throw new Error(event.modelTimeoutException.message);
            }
            if ('serviceUnavailableException' in event && event.serviceUnavailableException?.message) {
                throw new Error(event.serviceUnavailableException.message);
            }
            if ('throttlingException' in event && event.throttlingException?.message) {
                throw new Error(event.throttlingException.message);
            }
        }

        const transcript = transcriptParts.join('').replace(/\s+/g, ' ').trim();
        if (!transcript) {
            throw new Error('Nova Sonic returned no transcript.');
        }
        return transcript;
    } catch (e: any) {
        console.error('InvokeModelWithBidirectionalStream Error:', e);
        throw new Error(`Nova Sonic transcription failed: ${e.message}`);
    }
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
        const response = await getBedrockClient(defaultRegion).send(command);
        if (response.output?.message?.content && response.output.message.content.length > 0) {
            return response.output.message.content[0].text || "{}";
        }
        return "{}";
    } catch (e: any) {
        console.error("ConverseCommand Error:", e);
        throw new Error(`Bedrock Converse API failed: ${e.message}`);
    }
};
