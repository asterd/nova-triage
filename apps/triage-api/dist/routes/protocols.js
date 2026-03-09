"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protocolRoutes = void 0;
const protocolRoutes = async (server) => {
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
exports.protocolRoutes = protocolRoutes;
