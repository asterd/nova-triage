"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const case_1 = require("./routes/case");
const protocols_1 = require("./routes/protocols");
const case_store_1 = require("./services/case-store");
const server = (0, fastify_1.default)({ logger: true });
server.register(cors_1.default, {
    origin: '*'
});
server.get('/api/health', async () => {
    return {
        status: 'ok',
        service: 'triage-api',
        timestamp: new Date().toISOString(),
        bedrock_region: process.env.AWS_REGION || 'us-east-1',
        bedrock_models: {
            lite: process.env.BEDROCK_NOVA_LITE_MODEL || 'us.amazon.nova-lite-v1:0',
            pro: process.env.BEDROCK_NOVA_PRO_MODEL || 'us.amazon.nova-pro-v1:0',
            sonic: process.env.BEDROCK_NOVA_SONIC_MODEL || 'amazon.nova-sonic-v1:0'
        },
        bedrock_voice_region: process.env.BEDROCK_NOVA_SONIC_REGION || 'us-east-1',
        bedrock_configured: Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI),
        case_store: (0, case_store_1.getCaseStats)()
    };
});
server.register(case_1.caseRoutes, { prefix: '/api/case' });
server.register(protocols_1.protocolRoutes, { prefix: '/api/protocols' });
const start = async () => {
    try {
        const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
