import { FastifyPluginAsync } from 'fastify';

import { PerformanceMonitor } from '../performance-monitor';
import { Raydium } from '../raydium';

export const performanceMetricsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/performance-metrics',
    {
      schema: {
        description: 'Get Raydium performance metrics and cache statistics',
        tags: ['raydium/amm'],
        response: {
          200: {
            type: 'object',
            properties: {
              operations: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    cacheHits: { type: 'number' },
                    cacheMisses: { type: 'number' },
                    averageResponseTime: { type: 'number' },
                    totalRequests: { type: 'number' },
                    cacheHitRate: { type: 'number' },
                  },
                },
              },
              cacheStats: {
                type: 'object',
                properties: {
                  poolCache: { type: 'number' },
                  quoteCache: { type: 'number' },
                  swapCache: { type: 'number' },
                },
              },
              summary: {
                type: 'object',
                properties: {
                  totalRequests: { type: 'number' },
                  averageResponseTime: { type: 'number' },
                  overallCacheHitRate: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (_request) => {
      try {
        const monitor = PerformanceMonitor.getInstance();
        const raydium = await Raydium.getInstance('mainnet-beta');
        const cacheStats = raydium.getCacheStats();

        // Update cache sizes in metrics
        monitor.updateCacheSizes(
          cacheStats.poolCache,
          cacheStats.quoteCache,
          cacheStats.swapCache,
        );

        const allMetrics = monitor.getMetrics() as Map<string, any>;
        const operations: any = {};
        let totalRequests = 0;
        let totalCacheHits = 0;
        let totalCacheMisses = 0;
        let totalResponseTime = 0;

        for (const [operation, metrics] of allMetrics.entries()) {
          const hitRate = monitor.getCacheHitRate(operation);
          operations[operation] = {
            cacheHits: metrics.cacheHits,
            cacheMisses: metrics.cacheMisses,
            averageResponseTime: metrics.averageResponseTime,
            totalRequests: metrics.totalRequests,
            cacheHitRate: hitRate,
          };

          totalRequests += metrics.totalRequests;
          totalCacheHits += metrics.cacheHits;
          totalCacheMisses += metrics.cacheMisses;
          totalResponseTime +=
            metrics.averageResponseTime * metrics.totalRequests;
        }

        const overallCacheHitRate =
          totalRequests > 0
            ? (totalCacheHits / (totalCacheHits + totalCacheMisses)) * 100
            : 0;

        const averageResponseTime =
          totalRequests > 0 ? totalResponseTime / totalRequests : 0;

        return {
          operations,
          cacheStats,
          summary: {
            totalRequests,
            averageResponseTime,
            overallCacheHitRate,
          },
        };
      } catch (error) {
        throw fastify.httpErrors.internalServerError(
          'Failed to get performance metrics',
        );
      }
    },
  );

  fastify.post(
    '/performance-metrics/reset',
    {
      schema: {
        description: 'Reset all performance metrics',
        tags: ['raydium/amm'],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request) => {
      try {
        const monitor = PerformanceMonitor.getInstance();
        monitor.resetMetrics();

        return {
          message: 'Performance metrics reset successfully',
        };
      } catch (error) {
        throw fastify.httpErrors.internalServerError(
          'Failed to reset performance metrics',
        );
      }
    },
  );

  fastify.post(
    '/cache/clear',
    {
      schema: {
        description: 'Clear all caches',
        tags: ['raydium/amm'],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              cacheStats: {
                type: 'object',
                properties: {
                  poolCache: { type: 'number' },
                  quoteCache: { type: 'number' },
                  swapCache: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (_request) => {
      try {
        const raydium = await Raydium.getInstance('mainnet-beta');
        raydium.clearCache();

        const cacheStats = raydium.getCacheStats();

        return {
          message: 'All caches cleared successfully',
          cacheStats,
        };
      } catch (error) {
        throw fastify.httpErrors.internalServerError('Failed to clear caches');
      }
    },
  );
};
