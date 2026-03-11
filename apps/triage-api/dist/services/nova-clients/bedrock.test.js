"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const bedrock_1 = require("./bedrock");
const encodeEvent = (event) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify({ event }), 'utf8')
    }
});
(0, vitest_1.describe)('extractNovaSonicResponse', () => {
    (0, vitest_1.it)('collects final user ASR transcript linked by contentId', () => {
        const result = (0, bedrock_1.extractNovaSonicResponse)([
            encodeEvent({
                contentStart: {
                    promptName: 'transcribe_audio',
                    contentId: 'user-text-1',
                    type: 'TEXT',
                    role: 'USER',
                    interactive: false,
                    additionalModelFields: JSON.stringify({ generationStage: 'FINAL' })
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'user-text-1',
                    content: 'Patient reports '
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'user-text-1',
                    content: 'chest pain for ten minutes.'
                }
            }),
            encodeEvent({
                contentEnd: {
                    contentId: 'user-text-1'
                }
            })
        ]);
        (0, vitest_1.expect)(result.transcript).toBe('Patient reports chest pain for ten minutes.');
    });
    (0, vitest_1.it)('ignores speculative assistant text and keeps final assistant or user text only', () => {
        const result = (0, bedrock_1.extractNovaSonicResponse)([
            encodeEvent({
                contentStart: {
                    contentId: 'assistant-speculative-1',
                    type: 'TEXT',
                    role: 'ASSISTANT',
                    interactive: false,
                    additionalModelFields: JSON.stringify({ generationStage: 'SPECULATIVE' })
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'assistant-speculative-1',
                    content: 'Preview text that should be ignored.'
                }
            }),
            encodeEvent({
                contentStart: {
                    contentId: 'assistant-final-1',
                    type: 'TEXT',
                    role: 'ASSISTANT',
                    interactive: false,
                    additionalModelFields: JSON.stringify({ generationStage: 'FINAL' })
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'assistant-final-1',
                    content: 'Include this.'
                }
            })
        ]);
        (0, vitest_1.expect)(result.transcript).toBe('Include this.');
        (0, vitest_1.expect)(result.assistantTranscript).toBe('Include this.');
        (0, vitest_1.expect)(result.userTranscript).toBe('');
    });
    (0, vitest_1.it)('separates user transcript from assistant transcript', () => {
        const result = (0, bedrock_1.extractNovaSonicResponse)([
            encodeEvent({
                contentStart: {
                    contentId: 'user-final-1',
                    type: 'TEXT',
                    role: 'USER',
                    interactive: false,
                    additionalModelFields: JSON.stringify({ generationStage: 'FINAL' })
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'user-final-1',
                    content: 'Ho mal di testa.'
                }
            }),
            encodeEvent({
                contentStart: {
                    contentId: 'assistant-final-1',
                    type: 'TEXT',
                    role: 'ASSISTANT',
                    interactive: false,
                    additionalModelFields: JSON.stringify({ generationStage: 'FINAL' })
                }
            }),
            encodeEvent({
                textOutput: {
                    contentId: 'assistant-final-1',
                    content: 'Da quanto tempo dura?'
                }
            })
        ]);
        (0, vitest_1.expect)(result.userTranscript).toBe('Ho mal di testa.');
        (0, vitest_1.expect)(result.assistantTranscript).toBe('Da quanto tempo dura?');
        (0, vitest_1.expect)(result.transcript).toBe('Ho mal di testa.Da quanto tempo dura?');
    });
});
(0, vitest_1.describe)('buildSonicInputStream', () => {
    (0, vitest_1.it)('sets mediaType for every text contentStart event', async () => {
        const events = await (0, bedrock_1.collectSonicInputEventsForTest)(new Uint8Array([0, 0, 1, 0]), 'system prompt', 16000);
        const textContentStarts = events
            .map((payload) => payload.event?.contentStart)
            .filter((contentStart) => Boolean(contentStart?.type === 'TEXT'));
        (0, vitest_1.expect)(textContentStarts).toHaveLength(1);
        (0, vitest_1.expect)(textContentStarts).toSatisfy((entries) => entries.every((entry) => entry.textInputConfiguration?.mediaType === 'text/plain'));
    });
    (0, vitest_1.it)('marks user audio as interactive and restores VAD timing config', async () => {
        const events = await (0, bedrock_1.collectSonicInputEventsForTest)(new Uint8Array([0, 0, 1, 0]), 'system prompt', 16000);
        const sessionStart = events
            .map((payload) => payload.event?.sessionStart)
            .find(Boolean);
        const audioContentStart = events
            .map((payload) => payload.event?.contentStart)
            .find((contentStart) => contentStart?.type === 'AUDIO');
        (0, vitest_1.expect)(sessionStart?.turnDetectionConfiguration?.voiceActivityDetectionConfiguration).toEqual({
            startTimeout: 0,
            endTimeout: 200
        });
        (0, vitest_1.expect)(audioContentStart?.interactive).toBe(true);
    });
});
(0, vitest_1.describe)('resolveSonicModelCandidates', () => {
    (0, vitest_1.it)('prefers Nova 2 Sonic and falls back to legacy Sonic by default', () => {
        const original = process.env.BEDROCK_NOVA_SONIC_MODEL;
        delete process.env.BEDROCK_NOVA_SONIC_MODEL;
        (0, vitest_1.expect)((0, bedrock_1.resolveSonicModelCandidatesForTest)()).toEqual([
            'amazon.nova-2-sonic-v1:0',
            'amazon.nova-sonic-v1:0'
        ]);
        if (original) {
            process.env.BEDROCK_NOVA_SONIC_MODEL = original;
        }
    });
    (0, vitest_1.it)('normalizes an explicitly configured Sonic model id', () => {
        const original = process.env.BEDROCK_NOVA_SONIC_MODEL;
        process.env.BEDROCK_NOVA_SONIC_MODEL = 'us.amazon.nova-2-sonic-v1:0';
        (0, vitest_1.expect)((0, bedrock_1.resolveSonicModelCandidatesForTest)()).toEqual(['amazon.nova-2-sonic-v1:0']);
        if (original) {
            process.env.BEDROCK_NOVA_SONIC_MODEL = original;
        }
        else {
            delete process.env.BEDROCK_NOVA_SONIC_MODEL;
        }
    });
});
