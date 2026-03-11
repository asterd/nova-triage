# Nova Triage - Detailed Flow Map

This document outlines the core logical flows of the application, explicitly mapping the frontend components to their corresponding backend routes, services, and methods.

---

## 1. Intake & Triage Flow
**Purpose:** Collect patient symptoms (via text/voice) and attachments, analyze them using a clinical multi-step Bedrock agent pipeline, and generate a triage result (urgency, differential diagnosis, handoff).

### Frontend (`apps/frontend-pwa`)
*   **`src/app/intake/page.tsx`**
    *   `startRecording()` / `stopRecording()`: Captures dictation directly using the native browser `SpeechRecognition` API (WebKit/Standard) abandoning backend roundtrips.
    *   `ensureCase()`: Fetches or creates a local session case ID.
    *   *(API Call)* → `POST /api/case/start`
    *   `handleAnalyze()`: Gathers redacted text, attachments, and demographics, and submits the case for analysis.
    *   *(API Calls)* → `POST /api/case/intake` (draft saving) and `POST /api/case/analyze` (evaluation).

### Backend (`apps/triage-api`)
*   **`src/routes/case.ts`**
    *   `POST /api/case/analyze`: Handles the main evaluation request. Calls `runOrchestrationPipeline()` and saves the final result using `storeCaseResult()`.
*   **`src/services/agent-orchestrator/pipeline.ts`**
    *   `runOrchestrationPipeline()`: The core algorithmic orchestration logic. Sequentially invokes:
        1.  `invokeNovaLite(INTAKE_NORMALIZER_PROMPT)`: Cleans and normalizes the raw patient input.
        2.  `invokeNovaLite(SYMPTOM_STRUCTURER_PROMPT)`: Converts narrative text into structured symptom JSON.
        3.  `evaluateSafetyRules()`: Applies deterministic business logic (from `safety.ts`) to immediately flag critical issues.
        4.  `invokeNovaMultimodal(MULTIMODAL_EXTRACTOR_PROMPT)`: *(Optional)* Extracts clinical findings from uploaded attachments.
        5.  `invokeNovaLite(RISK_CLASSIFIER_PROMPT)`: Determines the urgency and clinical risk factors.
        6.  `invokeNovaPro(DIFFERENTIAL_CLUSTER_PROMPT)`: Formulates potential differential diagnoses.
        7.  `invokeNovaPro(HANDOFF_COMPOSER_PROMPT)`: Generates the Markdown summary tailored for the receiving clinician.
        8.  `invokeNovaLite(PATIENT_EXPLANATION_PROMPT)`: Generates the patient-friendly final explanation.
*   **`src/services/nova-clients/bedrock.ts`**
    *   `invokeNovaLite()`, `invokeNovaPro()`, `invokeNovaMultimodal()`, `invokeNovaSonic()`: AWS Bedrock wrappers that format requests and handle model-specific constraints.

---

## 2. Clinical Report Analysis Flow
**Purpose:** Analyze unstructured medical reports to extract key findings, reassuring elements, and attention points.

### Frontend (`apps/frontend-pwa`)
*   **`src/app/reports/page.tsx`**
    *   `handleAnalyze()`: Sends `redactedText` and attachments to the backend.
    *   *(API Call)* → `POST /api/case/report-analyze`

### Backend (`apps/triage-api`)
*   **`src/routes/case.ts`**
    *   `POST /api/case/report-analyze`: Validates the payload and passes it to the pipeline.
*   **`src/services/agent-orchestrator/pipeline.ts`**
    *   `runReportAnalysis()`: Dispatches the prompt to Bedrock using either `invokeNovaPro()` (text-only) or `invokeNovaMultimodal()` (with attachments).
    *   `normalizeAttentionPoints()`: Post-processes the LLM output to strongly format the severity labels (`high`, `moderate`, `low`).

---

## 3. Medication Lookup Flow
**Purpose:** Surface dosage tables, contraindications, and interaction guardrails for specific medications matched against patient demographics.

### Frontend (`apps/frontend-pwa`)
*   **`src/app/medications/page.tsx`**
    *   `handleLookup()`: Submits the drug name, indication, and patient weight/age.
    *   *(API Call)* → `POST /api/case/medication-info`

### Backend (`apps/triage-api`)
*   **`src/routes/case.ts`**
    *   `POST /api/case/medication-info`: Extracts parameters and triggers the lookup.
*   **`src/services/agent-orchestrator/pipeline.ts`**
    *   `runMedicationLookup()`: Calls the LLM to get general medication data.
    *   `refineDosageTable()`: Reorders the response dosage rows based on demographic matching algorithms.
    *   `buildPatientSpecificDoseRow()`: Deterministically calculates an exact dose range explicitly if a weight (`weight_kg`) is provided.
    *   `buildMedicationGuardrails()`: Injects deterministic safety disclaimers (e.g., pediatric warning if age is low).

---

## 4. Document Privacy & Anonymization Flow (Client-Side)
**Purpose:** Run OCR, text extraction, and redaction entirely locally in the browser to ensure PII never reaches the backend unencrypted.

### Frontend (`apps/frontend-pwa`)
*   **`src/app/document-privacy/page.tsx`**
    *   UI for processing PDFs.
    *   `handleProcess()`: Orchestrates the redaction pipeline.
*   **`src/lib/pdf-anonymizer.ts`**
    *   `anonymizePdfDocument()`: The main entry point for the obfuscation routine.
    *   `readPdfFile()`: Parses PDF binary using `pdf.js`.
    *   `renderPageToImageData()`: Rasterizes the PDF for optical processing.
    *   `detectTextInImage()`: Runs local `Tesseract.js` OCR.
    *   `drawRedactionsOnPdf()`: Obfuscates detected findings in the generated export blob.
*   **`src/lib/privacy-engine.ts`**
    *   `redactPII()`: Regex-based pattern matching (e.g., emails, SSNs).
    *   `prepareAttachment()`: The proxy method required before attaching any document to other flows (blocks uploads if manual review is deemed necessary).

---

## 5. Interactive Voice Assistant Flow
**Purpose:** Provide a dedicated screen for conversational, bounded interactions regarding symptoms and medications using native browser STT and bidirectional Nova Sonic audio.

### Frontend (`apps/frontend-pwa`)
*   **`src/components/bottom-navigation.tsx`**
    *   Renders the central floating microphone button acting as the entry point to the assistant.
*   **`src/app/voice-assistant/page.tsx` & `src/components/VoiceAssistant.tsx`**
    *   `useAudioRecorder()`: Captures PCM audio through the browser's `MediaRecorder`.
    *   `handleMicPress()`: Flushes the chunked recording to the backend endpoint.
    *   `playAudioBase64()`: Plays back the synthetic PCM audio response returned natively by the assistant.
    *   Renders a botta-risposta chat interface with strict out-of-scope refusal handling.

### Backend (`apps/triage-api`)
*   **`src/routes/voice-assistant.ts`**
    *   `POST /api/case/voice-assistant/turn`: Receives audio, injects a hyper-strict prompt bounding the LLM to triage/medications only, and calls Bedrock.
*   **`src/services/nova-clients/bedrock.ts`**
    *   `invokeNovaSonic()`: Handles bidirectional streaming with AWS.
    *   `extractNovaSonicResponse()`: Extracts *both* the transcription text of the session and the Assistant's generated `audioOutput` bytes (synthetic voice).
