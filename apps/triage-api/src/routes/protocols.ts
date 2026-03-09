import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const protocolRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.get('/', async (request, reply) => {
        return {
            protocols: [
                { id: 'generic', label: 'Generic Flow' },
                { id: 'italy', label: 'Italian Protocol' },
                { id: 'home', label: 'Home Care' }
            ]
        };
    });
};
