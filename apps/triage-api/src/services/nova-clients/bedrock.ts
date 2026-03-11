import { BedrockRuntimeClient, ConverseCommand, InvokeModelWithBidirectionalStreamCommand, Message } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { randomUUID } from 'node:crypto';

if (process.env.BEDROCK_ALLOW_INSECURE_TLS === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

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

const DEFAULT_SONIC_MODEL = 'amazon.nova-2-sonic-v1:0';
const LEGACY_SONIC_MODEL = 'amazon.nova-sonic-v1:0';
const SONIC_FRAME_DURATION_MS = 32;   // ms per audio chunk — matches real-time mic cadence
const SONIC_POST_SILENCE_MS = 800;    // trailing silence so VAD detects end-of-speech
const SONIC_TEXT_MIME = 'text/plain';
const SONIC_AUDIO_MIME = 'audio/lpcm';
const SONIC_MODEL_ID_PATTERN = /nova(?:-\d+)?-sonic/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SonicTranscriptOptions = {
    sampleRateHertz?: number;
    prompt?: string;
};

type SonicChunkPayload = {
    event?: {
        contentStart?: {
            contentId?: string;
            contentName?: string;
            type?: string;
            role?: string;
            interactive?: boolean;
            additionalModelFields?: string;
        };
        contentEnd?: {
            contentId?: string;
            contentName?: string;
        };
        textOutput?: {
            content?: string;
            contentId?: string;
            contentName?: string;
        };
        audioOutput?: {
            content?: string;
            contentId?: string;
            contentName?: string;
        };
    };
};

type SonicContentMeta = {
    role?: string;
    type?: string;
    interactive?: boolean;
    generationStage?: string;
};

type SonicEventSummary = {
    eventNames: string[];
    textOutputs: Array<{
        contentKey?: string;
        role?: string;
        generationStage?: string;
        preview: string;
    }>;
};

const normalizeSonicModelId = (modelId: string) => modelId.replace(/^(?:[a-z]{2}\.)?amazon\./i, 'amazon.');

const shouldFallbackToLegacySonic = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return /(resource.?not.?found|model.?not.?found|access.?denied|not authorized|unsupported|validation exception|validationexception)/i.test(message);
};

const resolveSonicModelCandidates = () => {
    const configured = process.env.BEDROCK_NOVA_SONIC_MODEL?.trim();
    if (configured) {
        const normalized = normalizeSonicModelId(configured);
        if (!SONIC_MODEL_ID_PATTERN.test(normalized)) {
            throw new Error('BEDROCK_NOVA_SONIC_MODEL must target Amazon Nova Sonic, for example amazon.nova-2-sonic-v1:0 or amazon.nova-sonic-v1:0.');
        }
        return [normalized];
    }

    return [DEFAULT_SONIC_MODEL, LEGACY_SONIC_MODEL];
};

export const resolveSonicModelCandidatesForTest = resolveSonicModelCandidates;

const encodeSonicEvent = (event: Record<string, unknown>) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify(event), 'utf8')
    }
});

const buildTextContentStart = (
    promptName: string,
    contentName: string,
    role: 'SYSTEM' | 'USER'
) => ({
    promptName,
    contentName,
    type: 'TEXT',
    role,
    interactive: false,
    textInputConfiguration: {
        mediaType: SONIC_TEXT_MIME
    }
});

async function* buildSonicInputStream(audioBytes: Uint8Array, systemPrompt: string, sampleRateHertz: number) {
    const promptName = randomUUID();
    const systemInstructionContentName = randomUUID();
    const patientAudioContentName = randomUUID();

    yield encodeSonicEvent({
        event: {
            sessionStart: {
                inferenceConfiguration: {
                    maxTokens: 1024,
                    topP: 0.9,
                    temperature: 0
                },
                turnDetectionConfiguration: {
                    voiceActivityDetectionConfiguration: {
                        startTimeout: 0,
                        endTimeout: 200
                    }
                }
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            promptStart: {
                promptName,
                textOutputConfiguration: { mediaType: SONIC_TEXT_MIME },
                audioOutputConfiguration: {
                    mediaType: SONIC_AUDIO_MIME,
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
            contentStart: buildTextContentStart(promptName, systemInstructionContentName, 'SYSTEM')
        }
    });

    yield encodeSonicEvent({
        event: {
            textInput: {
                promptName,
                contentName: systemInstructionContentName,
                content: systemPrompt
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName,
                contentName: systemInstructionContentName
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            contentStart: {
                promptName,
                contentName: patientAudioContentName,
                type: 'AUDIO',
                role: 'USER',
                interactive: true,
                audioInputConfiguration: {
                    mediaType: SONIC_AUDIO_MIME,
                    sampleRateHertz,
                    sampleSizeBits: 16,
                    channelCount: 1,
                    audioType: 'SPEECH',
                    encoding: 'base64'
                }
            }
        }
    });

    const bytesPerSample = 2;
    const frameSamples = Math.max(1, Math.round((sampleRateHertz * SONIC_FRAME_DURATION_MS) / 1000));
    const chunkSize = frameSamples * bytesPerSample;

    for (let offset = 0; offset < audioBytes.length; offset += chunkSize) {
        const frame = audioBytes.slice(offset, Math.min(audioBytes.length, offset + chunkSize));
        yield encodeSonicEvent({
            event: {
                audioInput: {
                    promptName,
                    contentName: patientAudioContentName,
                    content: Buffer.from(frame).toString('base64')
                }
            }
        });
        await sleep(SONIC_FRAME_DURATION_MS);
    }

    const silenceFrames = Math.ceil(SONIC_POST_SILENCE_MS / SONIC_FRAME_DURATION_MS);
    const silenceChunk = Buffer.alloc(chunkSize).toString('base64');
    for (let i = 0; i < silenceFrames; i++) {
        yield encodeSonicEvent({
            event: {
                audioInput: {
                    promptName,
                    contentName: patientAudioContentName,
                    content: silenceChunk
                }
            }
        });
        await sleep(SONIC_FRAME_DURATION_MS);
    }

    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName,
                contentName: patientAudioContentName
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            promptEnd: {
                promptName
            }
        }
    });

    yield encodeSonicEvent({
        event: {
            sessionEnd: {}
        }
    });
}

const parseSonicAdditionalModelFields = (raw?: string) => {
    if (!raw) {
        return {};
    }

    try {
        return JSON.parse(raw) as { generationStage?: string };
    } catch {
        return {};
    }
};

export const collectSonicInputEventsForTest = async (
    audioBytes: Uint8Array,
    systemPrompt: string,
    sampleRateHertz: number
) => {
    const events: Array<Record<string, unknown>> = [];
    for await (const part of buildSonicInputStream(audioBytes, systemPrompt, sampleRateHertz)) {
        const payload = JSON.parse(Buffer.from(part.chunk.bytes).toString('utf8')) as Record<string, unknown>;
        events.push(payload);
    }
    return events;
};

const summarizeSonicEvent = (streamEvent: { chunk?: { bytes?: Uint8Array } }): SonicEventSummary | null => {
    if (!streamEvent.chunk?.bytes) {
        return null;
    }

    const payloadText = Buffer.from(streamEvent.chunk.bytes).toString('utf8');
    const payload = JSON.parse(payloadText) as SonicChunkPayload;
    const event = payload.event;
    if (!event) {
        return null;
    }

    const eventNames = Object.keys(event);
    const textOutputs: SonicEventSummary['textOutputs'] = [];
    if (typeof event.textOutput?.content === 'string') {
        const contentKey = event.textOutput.contentId || event.textOutput.contentName;
        const additionalModelFields = parseSonicAdditionalModelFields(event.contentStart?.additionalModelFields);
        textOutputs.push({
            contentKey,
            role: event.contentStart?.role,
            generationStage: additionalModelFields.generationStage,
            preview: event.textOutput.content.slice(0, 120)
        });
    }

    return { eventNames, textOutputs };
};

const analyzePcm16Audio = (audioBytes: Uint8Array, sampleRateHertz: number) => {
    const sampleCount = Math.floor(audioBytes.length / 2);
    let peak = 0;
    let sumSquares = 0;

    for (let offset = 0; offset + 1 < audioBytes.length; offset += 2) {
        const sample = Buffer.from(audioBytes.buffer, audioBytes.byteOffset + offset, 2).readInt16LE(0) / 32768;
        const abs = Math.abs(sample);
        if (abs > peak) {
            peak = abs;
        }
        sumSquares += sample * sample;
    }

    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;

    return {
        bytes: audioBytes.length,
        durationMs: Math.round((sampleCount / sampleRateHertz) * 1000),
        peak: Number(peak.toFixed(4)),
        rms: Number(rms.toFixed(4))
    };
};

export const extractNovaSonicResponse = (streamEvents: Array<{ chunk?: { bytes?: Uint8Array } }>) => {
    const transcriptParts: string[] = [];
    const userTranscriptParts: string[] = [];
    const assistantTranscriptParts: string[] = [];
    const audioChunks: Buffer[] = [];
    const contentRoles = new Map<string, SonicContentMeta>();

    for (const streamEvent of streamEvents) {
        if (!streamEvent.chunk?.bytes) {
            continue;
        }

        const payloadText = Buffer.from(streamEvent.chunk.bytes).toString('utf8');
        const payload = JSON.parse(payloadText) as SonicChunkPayload;
        const event = payload.event;
        if (!event) {
            continue;
        }

        const contentStart = event.contentStart;
        if (contentStart) {
            const contentKey = contentStart.contentId || contentStart.contentName;
            const generationStage = parseSonicAdditionalModelFields(contentStart.additionalModelFields).generationStage;
            if (contentKey) {
                contentRoles.set(contentKey, {
                    role: contentStart.role,
                    type: contentStart.type,
                    interactive: contentStart.interactive,
                    generationStage
                });
            }
        }

        const textOutput = event.textOutput;
        if (typeof textOutput?.content === 'string') {
            const contentKey = textOutput.contentId || textOutput.contentName;
            const contentMeta = contentKey ? contentRoles.get(contentKey) : undefined;
            const isFinalUserTranscript =
                contentMeta?.role === 'USER' &&
                contentMeta?.type === 'TEXT' &&
                (contentMeta.generationStage === 'FINAL' || !contentMeta.generationStage);
            const isFinalAssistantTranscript =
                contentMeta?.role === 'ASSISTANT' &&
                contentMeta?.type === 'TEXT' &&
                contentMeta.generationStage === 'FINAL';
            const isFallbackTranscript = !contentMeta && textOutput.content.trim().length > 0;

            if (isFinalUserTranscript || isFinalAssistantTranscript || isFallbackTranscript) {
                transcriptParts.push(textOutput.content);
            }
            if (isFinalUserTranscript) {
                userTranscriptParts.push(textOutput.content);
            }
            if (isFinalAssistantTranscript) {
                assistantTranscriptParts.push(textOutput.content);
            }
        }

        const audioOutput = event.audioOutput;
        if (typeof audioOutput?.content === 'string') {
            const contentKey = audioOutput.contentId || audioOutput.contentName;
            const contentMeta = contentKey ? contentRoles.get(contentKey) : undefined;
            
            // Only capture the Assistant's final generated audio back
            if (contentMeta?.role === 'ASSISTANT' && contentMeta?.type === 'AUDIO') {
                audioChunks.push(Buffer.from(audioOutput.content, 'base64'));
            }
        }

        const contentEnd = event.contentEnd;
        if (contentEnd) {
            const contentKey = contentEnd.contentId || contentEnd.contentName;
            if (contentKey) {
                contentRoles.delete(contentKey);
            }
        }
    }

    return {
        transcript: transcriptParts.join('').replace(/\s+/g, ' ').trim(),
        userTranscript: userTranscriptParts.join('').replace(/\s+/g, ' ').trim(),
        assistantTranscript: assistantTranscriptParts.join('').replace(/\s+/g, ' ').trim(),
        audioBytes: audioChunks.length > 0 ? Buffer.concat(audioChunks) : null
    };
};

const invokeNovaSonicWithModel = async (
    modelId: string,
    system: string,
    audioBase64: string,
    options: SonicTranscriptOptions = {}
) => {
    const sonicRegion = process.env.BEDROCK_NOVA_SONIC_REGION || 'us-east-1';

    const sampleRateHertz = options.sampleRateHertz || 16000;
    let audioBytes = Buffer.from(audioBase64, 'base64');

    if (audioBytes.length % 2 !== 0) {
        const padded = Buffer.alloc(audioBytes.length + 1);
        audioBytes.copy(padded);
        audioBytes = padded;
    }

    if (audioBytes.length === 0) {
        throw new Error('Audio payload is empty.');
    }

    const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: buildSonicInputStream(audioBytes, system, sampleRateHertz),
        contentType: 'application/json',
        accept: 'application/json'
    } as any);

    command.middlewareStack.add(
        (next) => async (args: any) => {
            const request = args.request as { headers?: Record<string, string> };
            request.headers = {
                ...(request.headers || {}),
                'content-type': 'application/json',
                accept: 'application/json',
                'x-amzn-bedrock-content-type': 'application/json',
                'x-amzn-bedrock-accept': 'application/json'
            };
            return next({ ...args, request });
        },
        { step: 'build', name: 'novaSonicContentTypeMiddleware' }
    );

    try {
        const response = await getBedrockClient(sonicRegion).send(command);
        const streamEvents: Array<{ chunk?: { bytes?: Uint8Array } }> = [];

        for await (const event of response.body ?? []) {
            if ('chunk' in event && event.chunk?.bytes) {
                streamEvents.push({ chunk: { bytes: event.chunk.bytes } });
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

        const result = extractNovaSonicResponse(streamEvents);
        if (!result.transcript && !result.audioBytes) {
            const audioStats = analyzePcm16Audio(audioBytes, sampleRateHertz);
            const eventSummaries = streamEvents
                .map((event) => summarizeSonicEvent(event))
                .filter((summary): summary is SonicEventSummary => Boolean(summary));
            console.error('Nova Sonic empty response diagnostics:', {
                modelId,
                sonicRegion,
                audio: audioStats,
                eventNames: eventSummaries.flatMap((summary) => summary.eventNames),
                textOutputs: eventSummaries.flatMap((summary) => summary.textOutputs)
            });
            throw new Error('Nova Sonic returned no response.');
        }
        return result;
    } catch (e: any) {
        throw new Error(`Nova Sonic exchange failed: ${e.message}`);
    }
};

export const invokeNovaSonic = async (system: string, audioBase64: string, options: SonicTranscriptOptions = {}) => {
    const candidates = resolveSonicModelCandidates();
    let lastError: unknown;

    for (let index = 0; index < candidates.length; index += 1) {
        const modelId = candidates[index];
        try {
            return await invokeNovaSonicWithModel(modelId, system, audioBase64, options);
        } catch (error) {
            lastError = error;
            const shouldFallback = index < candidates.length - 1 && !process.env.BEDROCK_NOVA_SONIC_MODEL && shouldFallbackToLegacySonic(error);
            if (!shouldFallback) {
                throw error;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Nova Sonic exchange failed.');
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
        throw new Error(`Bedrock Converse API failed: ${e.message}`);
    }
};
