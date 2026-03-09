import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const protocolRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.get('/', async (request, reply) => {
        return {
            protocols: [
                { id: 'generic', label: 'Generic standard (5-level)' },
                { id: 'italy', label: 'Italian standard' },
                { id: 'home', label: 'Home care guide' }
            ]
        };
    });
};
