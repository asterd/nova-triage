# NovaTriage

Privacy-first multilingual AI triage copilot developed for the Amazon Nova Hackathon.

## Features
- **Next.js PWA**: Mobile-first responsive app.
- **Client-Side Redaction**: Strips PII before reaching the server.
- **Agentic Pipeline**: 10-step Nova Bedrock agent orchestration evaluating symptoms and documents.
- **Protocol Packs**: Adapt output scales (Generic, Italian Triage, Home Care).

## Local Development
Requires Docker.
1. Copy `.env.example` to `.env` and configure your AWS credentials for Bedrock.
2. Run the environment:
   \`\`\`bash
   docker compose up --build
   \`\`\`
3. Open `http://localhost:3000` to interact with the frontend PWA. The backend Fastify API runs on `http://localhost:8080`.

## AWS EKS Deployment (Helm)
The deployment charts are located in `infra/helm/novatriage`. 

1. Push your docker images to your registry (e.g. ECR) after adjusting the domains in `values.yaml`.
2. Create a Kubernetes config secret for your sensitive AWS credentials named \`novatriage-secrets\`.
3. Install:
   \`\`\`bash
   helm install novatriage infra/helm/novatriage -f infra/helm/novatriage/values.yaml
   \`\`\`
