FROM node:20-alpine AS base
WORKDIR /app

FROM base AS dev
COPY package*.json ./
COPY apps/triage-api/package.json apps/triage-api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/prompts/package.json packages/prompts/
COPY packages/i18n/package.json packages/i18n/
COPY packages/protocol-packs/package.json packages/protocol-packs/
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "-w", "triage-api"]

FROM base AS prod
COPY package*.json ./
COPY apps/triage-api/package.json apps/triage-api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/prompts/package.json packages/prompts/
COPY packages/i18n/package.json packages/i18n/
COPY packages/protocol-packs/package.json packages/protocol-packs/
RUN npm install --production
COPY . .
RUN npm run build -w triage-api
CMD ["npm", "start", "-w", "triage-api"]
