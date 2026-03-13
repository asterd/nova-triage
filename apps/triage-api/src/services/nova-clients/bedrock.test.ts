import { afterEach, describe, expect, it } from 'vitest';
import {
    collectSonicInputEventsForTest,
    extractNovaSonicResponse,
    invokeNovaLite,
    isRetryableConverseTransportErrorForTest,
    resolveSonicModelCandidatesForTest,
    setConverseSenderForTest
} from './bedrock';

const encodeEvent = (event: Record<string, unknown>) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify({ event }), 'utf8')
    }
});

afterEach(() => {
    setConverseSenderForTest(null);
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

describe('invokeNovaConverse transport fallback', () => {
    it('retries Converse through HTTP/1.1 after an HTTP/2 empty-response failure', async () => {
        const calls: string[] = [];
        setConverseSenderForTest(async (_region, transport) => {
            calls.push(transport);
            if (calls.length === 1) {
                throw new Error('Unexpected error: http2 request did not get a response');
            }
            return '{"ok":true}';
        });

        await expect(invokeNovaLite('system', 'prompt')).resolves.toBe('{"ok":true}');
        expect(calls).toEqual(['http2', 'http2']);
    });

    it('retries transient DNS lookup failures before succeeding', async () => {
        const calls: string[] = [];
        setConverseSenderForTest(async (_region, transport) => {
            calls.push(transport);
            if (calls.length < 3) {
                throw new Error('The pending stream has been canceled (caused by: getaddrinfo EAI_AGAIN bedrock-runtime.eu-central-1.amazonaws.com)');
            }
            return '{"ok":true}';
        });

        await expect(invokeNovaLite('system', 'prompt')).resolves.toBe('{"ok":true}');
        expect(calls).toEqual(['http2', 'http2', 'http1']);
    });

    it('does not fallback on non-transport Converse failures', async () => {
        const calls: string[] = [];
        setConverseSenderForTest(async (_region, transport) => {
            calls.push(transport);
            throw new Error('ValidationException: malformed input');
        });

        await expect(invokeNovaLite('system', 'prompt')).rejects.toThrow(
            'Bedrock Converse API failed: ValidationException: malformed input'
        );
        expect(calls).toEqual(['http2']);
    });

    it('recognizes transient HTTP/2 transport failures as retryable', () => {
        expect(
            isRetryableConverseTransportErrorForTest(new Error('Unexpected error: http2 request did not get a response'))
        ).toBe(true);
        expect(
            isRetryableConverseTransportErrorForTest(
                new Error('The pending stream has been canceled (caused by: getaddrinfo EAI_AGAIN bedrock-runtime.eu-central-1.amazonaws.com)')
            )
        ).toBe(true);
        expect(
            isRetryableConverseTransportErrorForTest(new Error('ValidationException: malformed input'))
        ).toBe(false);
    });
});
