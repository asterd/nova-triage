"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protocolRoutes = void 0;
const protocolRoutes = async (server) => {
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
exports.protocolRoutes = protocolRoutes;
