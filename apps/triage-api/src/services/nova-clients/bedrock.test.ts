import { describe, expect, it } from 'vitest';
import { collectSonicInputEventsForTest, extractNovaSonicResponse, resolveSonicModelCandidatesForTest } from './bedrock';

const encodeEvent = (event: Record<string, unknown>) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify({ event }), 'utf8')
    }
});

describe('extractNovaSonicResponse', () => {
    it('collects final user ASR transcript linked by contentId', () => {
        const result = extractNovaSonicResponse([
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

        expect(result.transcript).toBe('Patient reports chest pain for ten minutes.');
    });

    it('ignores speculative assistant text and keeps final assistant or user text only', () => {
        const result = extractNovaSonicResponse([
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

        expect(result.transcript).toBe('Include this.');
        expect(result.assistantTranscript).toBe('Include this.');
        expect(result.userTranscript).toBe('');
    });

    it('separates user transcript from assistant transcript', () => {
        const result = extractNovaSonicResponse([
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

        expect(result.userTranscript).toBe('Ho mal di testa.');
        expect(result.assistantTranscript).toBe('Da quanto tempo dura?');
        expect(result.transcript).toBe('Ho mal di testa.Da quanto tempo dura?');
    });
});

describe('buildSonicInputStream', () => {
    it('sets mediaType for every text contentStart event', async () => {
        const events = await collectSonicInputEventsForTest(
            new Uint8Array([0, 0, 1, 0]),
            'system prompt',
            16000
        );

        const textContentStarts = events
            .map((payload) => (payload.event as Record<string, any> | undefined)?.contentStart)
            .filter((contentStart): contentStart is Record<string, any> => Boolean(contentStart?.type === 'TEXT'));

        expect(textContentStarts).toHaveLength(1);
        expect(textContentStarts).toSatisfy((entries: Array<Record<string, any>>) =>
            entries.every((entry: Record<string, any>) => entry.textInputConfiguration?.mediaType === 'text/plain')
        );
    });

    it('marks user audio as interactive and restores VAD timing config', async () => {
        const events = await collectSonicInputEventsForTest(
            new Uint8Array([0, 0, 1, 0]),
            'system prompt',
            16000
        );

        const sessionStart = events
            .map((payload) => (payload.event as Record<string, any> | undefined)?.sessionStart)
            .find(Boolean);
        const audioContentStart = events
            .map((payload) => (payload.event as Record<string, any> | undefined)?.contentStart)
            .find((contentStart) => contentStart?.type === 'AUDIO');

        expect(sessionStart?.turnDetectionConfiguration?.voiceActivityDetectionConfiguration).toEqual({
            startTimeout: 0,
            endTimeout: 200
        });
        expect(audioContentStart?.interactive).toBe(true);
    });
});

describe('resolveSonicModelCandidates', () => {
    it('prefers Nova 2 Sonic and falls back to legacy Sonic by default', () => {
        const original = process.env.BEDROCK_NOVA_SONIC_MODEL;
        delete process.env.BEDROCK_NOVA_SONIC_MODEL;

        expect(resolveSonicModelCandidatesForTest()).toEqual([
            'amazon.nova-2-sonic-v1:0',
            'amazon.nova-sonic-v1:0'
        ]);

        if (original) {
            process.env.BEDROCK_NOVA_SONIC_MODEL = original;
        }
    });

    it('normalizes an explicitly configured Sonic model id', () => {
        const original = process.env.BEDROCK_NOVA_SONIC_MODEL;
        process.env.BEDROCK_NOVA_SONIC_MODEL = 'us.amazon.nova-2-sonic-v1:0';

        expect(resolveSonicModelCandidatesForTest()).toEqual(['amazon.nova-2-sonic-v1:0']);

        if (original) {
            process.env.BEDROCK_NOVA_SONIC_MODEL = original;
        } else {
            delete process.env.BEDROCK_NOVA_SONIC_MODEL;
        }
    });
});
