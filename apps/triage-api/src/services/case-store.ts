import type { AIResult } from 'shared-types';

export interface CaseRecord {
    case_id: string;
    alias: string;
    created_at: string;
    updated_at: string;
    status: 'draft' | 'analyzing' | 'completed' | 'error';
    setup?: Record<string, unknown>;
    intake?: {
        text: string;
        attachments_count: number;
    };
    latest_result?: AIResult;
    latest_error?: string;
}

const cases = new Map<string, CaseRecord>();

export const createCaseRecord = (alias: string, setup?: Record<string, unknown>): CaseRecord => {
    const now = new Date().toISOString();
    const record: CaseRecord = {
        case_id: crypto.randomUUID(),
        alias,
        created_at: now,
        updated_at: now,
        status: 'draft',
        setup
    };
    cases.set(record.case_id, record);
    return record;
};

export const getCaseRecord = (caseId: string) => cases.get(caseId) || null;

export const upsertCaseIntake = (caseId: string, payload: { text: string; attachments_count: number; setup?: Record<string, unknown> }) => {
    const existing = getCaseRecord(caseId);
    if (!existing) return null;

    const updated: CaseRecord = {
        ...existing,
        setup: payload.setup || existing.setup,
        intake: {
            text: payload.text,
            attachments_count: payload.attachments_count
        },
        updated_at: new Date().toISOString()
    };
    cases.set(caseId, updated);
    return updated;
};

export const updateCaseStatus = (caseId: string, status: CaseRecord['status'], latest_error?: string) => {
    const existing = getCaseRecord(caseId);
    if (!existing) return null;

    const updated: CaseRecord = {
        ...existing,
        status,
        latest_error,
        updated_at: new Date().toISOString()
    };
    cases.set(caseId, updated);
    return updated;
};

export const storeCaseResult = (caseId: string, result: AIResult) => {
    const existing = getCaseRecord(caseId);
    if (!existing) return null;

    const updated: CaseRecord = {
        ...existing,
        latest_result: result,
        status: 'completed',
        latest_error: undefined,
        updated_at: new Date().toISOString()
    };
    cases.set(caseId, updated);
    return updated;
};

export const getCaseStats = () => ({
    total_cases: cases.size,
    completed_cases: Array.from(cases.values()).filter((item) => item.status === 'completed').length
});
