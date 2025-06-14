import { logger } from '../../services/logger';

export interface PerformanceMetrics {
  cacheHits: number;
  cacheMisses: number;
  averageResponseTime: number;
  totalRequests: number;
  poolCacheSize: number;
  quoteCacheSize: number;
  swapCacheSize: number;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private startTimes: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startTimer(operation: string): void {
    this.startTimes.set(operation, Date.now());
  }

  endTimer(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (!startTime) {
      logger.warn(`No start time found for operation: ${operation}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.startTimes.delete(operation);

    // Update metrics
    const currentMetrics =
      this.metrics.get(operation) || this.getDefaultMetrics();
    currentMetrics.totalRequests++;
    currentMetrics.averageResponseTime =
      (currentMetrics.averageResponseTime * (currentMetrics.totalRequests - 1) +
        duration) /
      currentMetrics.totalRequests;

    this.metrics.set(operation, currentMetrics);

    return duration;
  }

  recordCacheHit(operation: string): void {
    const currentMetrics =
      this.metrics.get(operation) || this.getDefaultMetrics();
    currentMetrics.cacheHits++;
    this.metrics.set(operation, currentMetrics);
  }

  recordCacheMiss(operation: string): void {
    const currentMetrics =
      this.metrics.get(operation) || this.getDefaultMetrics();
    currentMetrics.cacheMisses++;
    this.metrics.set(operation, currentMetrics);
  }

  updateCacheSizes(
    poolCacheSize: number,
    quoteCacheSize: number,
    swapCacheSize: number,
  ): void {
    for (const [operation, metrics] of this.metrics.entries()) {
      metrics.poolCacheSize = poolCacheSize;
      metrics.quoteCacheSize = quoteCacheSize;
      metrics.swapCacheSize = swapCacheSize;
      this.metrics.set(operation, metrics);
    }
  }

  getMetrics(
    operation?: string,
  ): PerformanceMetrics | Map<string, PerformanceMetrics> {
    if (operation) {
      return this.metrics.get(operation) || this.getDefaultMetrics();
    }
    return this.metrics;
  }

  getCacheHitRate(operation: string): number {
    const metrics = this.metrics.get(operation);
    if (!metrics || metrics.totalRequests === 0) {
      return 0;
    }
    return (
      (metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)) * 100
    );
  }

  logPerformanceReport(): void {
    logger.info('=== Raydium Performance Report ===');

    for (const [operation, metrics] of this.metrics.entries()) {
      const hitRate = this.getCacheHitRate(operation);
      logger.info(`${operation}:`);
      logger.info(`  Total Requests: ${metrics.totalRequests}`);
      logger.info(`  Cache Hit Rate: ${hitRate.toFixed(2)}%`);
      logger.info(
        `  Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms`,
      );
      logger.info(`  Cache Hits: ${metrics.cacheHits}`);
      logger.info(`  Cache Misses: ${metrics.cacheMisses}`);
      logger.info(`  Pool Cache Size: ${metrics.poolCacheSize}`);
      logger.info(`  Quote Cache Size: ${metrics.quoteCacheSize}`);
      logger.info(`  Swap Cache Size: ${metrics.swapCacheSize}`);
      logger.info('');
    }
  }

  resetMetrics(): void {
    this.metrics.clear();
    this.startTimes.clear();
    logger.info('Performance metrics reset');
  }

  private getDefaultMetrics(): PerformanceMetrics {
    return {
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      totalRequests: 0,
      poolCacheSize: 0,
      quoteCacheSize: 0,
      swapCacheSize: 0,
    };
  }
}

// Performance decorator for easy timing
export function measurePerformance(operation: string) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const monitor = PerformanceMonitor.getInstance();
      monitor.startTimer(operation);

      try {
        const result = await originalMethod.apply(this, args);
        const duration = monitor.endTimer(operation);
        logger.debug(`${operation} completed in ${duration}ms`);
        return result;
      } catch (error) {
        monitor.endTimer(operation);
        throw error;
      }
    };

    return descriptor;
  };
}
