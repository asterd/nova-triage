"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const case_1 = require("./routes/case");
const protocols_1 = require("./routes/protocols");
const server = (0, fastify_1.default)({ logger: true });
server.register(cors_1.default, {
    origin: '*'
});
server.get('/api/health', async () => {
    return { status: 'ok' };
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
