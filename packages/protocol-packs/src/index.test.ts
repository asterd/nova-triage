import { describe, it, expect } from 'vitest';
import { ProtocolPacks } from './index';

describe('Protocol Packs', () => {
    it('should explicitly support italy, generic, and home protocols', () => {
        expect(ProtocolPacks.italy).toBeDefined();
        expect(ProtocolPacks.generic).toBeDefined();
        expect(ProtocolPacks.home).toBeDefined();
    });

    it('labels should exist for critical to minimal urgency levels', () => {
        const p = ProtocolPacks.generic;
        expect(p.labels.critical).toBeDefined();
        expect(p.labels.high).toBeDefined();
        expect(p.labels.moderate).toBeDefined();
        expect(p.labels.low).toBeDefined();
        expect(p.labels.minimal).toBeDefined();
    });
});
