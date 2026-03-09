import Fastify from 'fastify';
import cors from '@fastify/cors';
import { caseRoutes } from './routes/case';
import { protocolRoutes } from './routes/protocols';

const server = Fastify({ logger: true });

server.register(cors, {
    origin: '*'
});

server.get('/api/health', async () => {
    return { status: 'ok' };
});

server.register(caseRoutes, { prefix: '/api/case' });
server.register(protocolRoutes, { prefix: '/api/protocols' });

const start = async () => {
    try {
        const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
