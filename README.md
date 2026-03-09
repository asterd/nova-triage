# NovaTriage

Privacy-first multilingual AI triage copilot built for the Amazon Nova Hackathon.

## What is implemented

- Mobile-first Next.js PWA for triage, report review, medication guidance, and privacy inspection
- Amazon Nova integration through AWS Bedrock (`nova-lite`, `nova-pro`, `nova-micro`)
- Deterministic safety engine for high-risk overrides
- Client-side PII redaction for text and text-native PDFs
- Case lifecycle storage for demo flows (`start`, `intake`, `analyze`, `result`)
- Audit trail, clarification questions, and safety rule visibility in the result UI
- Demo scenarios preloaded directly from the home screen

## AWS prerequisites

Configure Bedrock access for the Amazon Nova models in your AWS account:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or `AWS_PROFILE`
- Optional model overrides:
  - `BEDROCK_NOVA_LITE_MODEL`
  - `BEDROCK_NOVA_PRO_MODEL`
  - `BEDROCK_NOVA_SONIC_MODEL`

The API will expose Bedrock configuration status at `/api/health`.

## Local development

1. Create `.env` with the AWS variables above.
2. Install dependencies:

```bash
npm install
```

3. Start the API:

```bash
npm run dev -w triage-api
```

4. In another terminal, start the frontend:

```bash
npm run dev -w frontend-pwa
```

5. Open `http://localhost:3000`.

## Docker

Run the full stack with healthchecks:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:3000`
- API: `http://localhost:8080`
- API health: `http://localhost:8080/api/health`

## Verification commands

Because `turbo` currently fails in this environment with a local TLS/keychain issue, use workspace scripts directly:

```bash
npm run test -w triage-api
npm run test -w frontend-pwa
npm run build -w triage-api
npm run build -w frontend-pwa
```

## Demo flow

Use the home page demo cards for three repeatable flows:

- Home-care triage with redacted attachment
- Objective report review
- Medication guardrail scenario

## Current limits

- Binary image and scan attachments remain `best effort` and may require manual review
- PDF support is focused on text-native documents, not scanned OCR-heavy files
- Case persistence is in-memory on the API plus local demo storage in the PWA
