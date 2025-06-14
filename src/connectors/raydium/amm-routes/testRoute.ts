import { FastifyPluginAsync } from 'fastify';

export const testRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/test-route',
    {
      schema: {
        description: 'Test route to verify registration',
        tags: ['raydium/amm'],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              timestamp: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return {
        message: 'Test route is working!',
        timestamp: Date.now(),
      };
    },
  );
};
