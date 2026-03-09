"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCaseStats = exports.storeCaseResult = exports.updateCaseStatus = exports.upsertCaseIntake = exports.getCaseRecord = exports.createCaseRecord = void 0;
const cases = new Map();
const createCaseRecord = (alias, setup) => {
    const now = new Date().toISOString();
    const record = {
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
exports.createCaseRecord = createCaseRecord;
const getCaseRecord = (caseId) => cases.get(caseId) || null;
exports.getCaseRecord = getCaseRecord;
const upsertCaseIntake = (caseId, payload) => {
    const existing = (0, exports.getCaseRecord)(caseId);
    if (!existing)
        return null;
    const updated = {
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
exports.upsertCaseIntake = upsertCaseIntake;
const updateCaseStatus = (caseId, status, latest_error) => {
    const existing = (0, exports.getCaseRecord)(caseId);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        status,
        latest_error,
        updated_at: new Date().toISOString()
    };
    cases.set(caseId, updated);
    return updated;
};
exports.updateCaseStatus = updateCaseStatus;
const storeCaseResult = (caseId, result) => {
    const existing = (0, exports.getCaseRecord)(caseId);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        latest_result: result,
        status: 'completed',
        latest_error: undefined,
        updated_at: new Date().toISOString()
    };
    cases.set(caseId, updated);
    return updated;
};
exports.storeCaseResult = storeCaseResult;
const getCaseStats = () => ({
    total_cases: cases.size,
    completed_cases: Array.from(cases.values()).filter((item) => item.status === 'completed').length
});
exports.getCaseStats = getCaseStats;
