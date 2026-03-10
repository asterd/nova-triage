import { describe, expect, it } from 'vitest';
import { extractNovaSonicTranscript } from './bedrock';

const encodeEvent = (event: Record<string, unknown>) => ({
    chunk: {
        bytes: Buffer.from(JSON.stringify({ event }), 'utf8')
    }
});

describe('extractNovaSonicTranscript', () => {
    it('collects final user ASR transcript linked by contentId', () => {
        const transcript = extractNovaSonicTranscript([
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

        expect(transcript).toBe('Patient reports chest pain for ten minutes.');
    });

    it('ignores speculative assistant text and keeps final assistant or user text only', () => {
        const transcript = extractNovaSonicTranscript([
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

        expect(transcript).toBe('Include this.');
    });
});
