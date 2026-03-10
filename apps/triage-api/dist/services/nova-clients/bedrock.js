"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeNovaMultimodal = exports.invokeNovaSonic = exports.extractNovaSonicTranscript = exports.invokeNovaPro = exports.invokeNovaLite = void 0;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const node_http_handler_1 = require("@smithy/node-http-handler");
const node_crypto_1 = require("node:crypto");
const clientCache = new Map();
const getBedrockClient = (region) => {
    if (!clientCache.has(region)) {
        clientCache.set(region, new client_bedrock_runtime_1.BedrockRuntimeClient({
            region,
            requestHandler: new node_http_handler_1.NodeHttp2Handler({
                requestTimeout: 300000,
                sessionTimeout: 300000,
                disableConcurrentStreams: false,
                maxConcurrentStreams: 20
            })
        }));
    }
    return clientCache.get(region);
};
const defaultRegion = process.env.AWS_REGION || 'us-east-1';
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
const DEFAULT_SONIC_MODEL = 'amazon.nova-sonic-v1:0';
const SONIC_FRAME_DURATION_MS = 32;
const SONIC_POST_AUDIO_FLUSH_MS = 160;
const encodeSonicEvent = (event) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify(event), 'utf8')
    }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function* buildSonicInputStream(audioBytes, systemPrompt, sampleRateHertz, prompt) {
    const promptName = (0, node_crypto_1.randomUUID)();
    const systemInstructionContentName = (0, node_crypto_1.randomUUID)();
    const userRequestContentName = (0, node_crypto_1.randomUUID)();
    const patientAudioContentName = (0, node_crypto_1.randomUUID)();
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
                promptName,
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
                promptName,
                contentName: systemInstructionContentName,
                type: 'TEXT',
                role: 'SYSTEM',
                interactive: false,
                textInputConfiguration: { mediaType: 'text/plain' }
            }
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
                contentName: userRequestContentName,
                type: 'TEXT',
                role: 'USER',
                interactive: false,
                textInputConfiguration: { mediaType: 'text/plain' }
            }
        }
    });
    yield encodeSonicEvent({
        event: {
            textInput: {
                promptName,
                contentName: userRequestContentName,
                content: prompt
            }
        }
    });
    yield encodeSonicEvent({
        event: {
            contentEnd: {
                promptName,
                contentName: userRequestContentName
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
                    mediaType: 'audio/lpcm',
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
    await sleep(SONIC_POST_AUDIO_FLUSH_MS);
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
const parseSonicAdditionalModelFields = (raw) => {
    if (!raw) {
        return {};
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
};
const summarizeSonicEvent = (streamEvent) => {
    if (!streamEvent.chunk?.bytes) {
        return null;
    }
    const payloadText = Buffer.from(streamEvent.chunk.bytes).toString('utf8');
    const payload = JSON.parse(payloadText);
    const event = payload.event;
    if (!event) {
        return null;
    }
    const eventNames = Object.keys(event);
    const textOutputs = [];
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
const analyzePcm16Audio = (audioBytes, sampleRateHertz) => {
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
const extractNovaSonicTranscript = (streamEvents) => {
    const transcriptParts = [];
    const contentRoles = new Map();
    for (const streamEvent of streamEvents) {
        if (!streamEvent.chunk?.bytes) {
            continue;
        }
        const payloadText = Buffer.from(streamEvent.chunk.bytes).toString('utf8');
        const payload = JSON.parse(payloadText);
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
            const isFinalUserTranscript = contentMeta?.role === 'USER' &&
                contentMeta?.type === 'TEXT' &&
                (contentMeta.generationStage === 'FINAL' || !contentMeta.generationStage);
            const isFinalAssistantTranscript = contentMeta?.role === 'ASSISTANT' &&
                contentMeta?.type === 'TEXT' &&
                contentMeta.generationStage === 'FINAL';
            const isFallbackTranscript = !contentMeta && textOutput.content.trim().length > 0;
            if (isFinalUserTranscript || isFinalAssistantTranscript || isFallbackTranscript) {
                transcriptParts.push(textOutput.content);
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
    return transcriptParts.join('').replace(/\s+/g, ' ').trim();
};
exports.extractNovaSonicTranscript = extractNovaSonicTranscript;
const invokeNovaSonic = async (system, audioBase64, options = {}) => {
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
    const command = new client_bedrock_runtime_1.InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: buildSonicInputStream(audioBytes, system, sampleRateHertz, prompt),
        contentType: 'application/json',
        accept: 'application/json'
    });
    command.middlewareStack.add((next) => async (args) => {
        const request = args.request;
        request.headers = {
            ...(request.headers || {}),
            'content-type': 'application/json',
            accept: 'application/json',
            'x-amzn-bedrock-content-type': 'application/json',
            'x-amzn-bedrock-accept': 'application/json'
        };
        return next({ ...args, request });
    }, { step: 'build', name: 'novaSonicContentTypeMiddleware' });
    try {
        const response = await getBedrockClient(sonicRegion).send(command);
        const streamEvents = [];
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
        const transcript = (0, exports.extractNovaSonicTranscript)(streamEvents);
        if (!transcript) {
            const audioStats = analyzePcm16Audio(audioBytes, sampleRateHertz);
            const eventSummaries = streamEvents
                .map((event) => summarizeSonicEvent(event))
                .filter((summary) => Boolean(summary));
            console.error('Nova Sonic empty transcript diagnostics:', {
                modelId,
                sonicRegion,
                audio: audioStats,
                eventNames: eventSummaries.flatMap((summary) => summary.eventNames),
                textOutputs: eventSummaries.flatMap((summary) => summary.textOutputs)
            });
            throw new Error('Nova Sonic returned no transcript.');
        }
        return transcript;
    }
    catch (e) {
        console.error('InvokeModelWithBidirectionalStream Error:', e);
        throw new Error(`Nova Sonic transcription failed: ${e.message}`);
    }
};
exports.invokeNovaSonic = invokeNovaSonic;
const invokeNovaMultimodal = async (modelId, system, text, attachments) => {
    const inlineTextAttachments = [];
    const contentBlocks = [{ text }];
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
        }
        else if (normalizedType === 'application/pdf' || ext === 'pdf') {
            contentBlocks.push({
                document: {
                    name: att.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10),
                    format: 'pdf',
                    source: { bytes: buffer }
                }
            });
        }
        else if (normalizedType.startsWith('text/') || normalizedType === 'application/json' || normalizedType === 'application/xml') {
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
        const response = await getBedrockClient(defaultRegion).send(command);
        if (response.output?.message?.content && response.output.message.content.length > 0) {
            return response.output.message.content[0].text || "{}";
        }
        return "{}";
    }
    catch (e) {
        console.error("ConverseCommand Error:", e);
        throw new Error(`Bedrock Converse API failed: ${e.message}`);
    }
};
