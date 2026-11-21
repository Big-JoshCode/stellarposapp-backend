import { config } from '@/config/config';
import * as horizon from '@/services/horizon';
import { isDatabaseHealthy } from '@/utils/database';
import { logger } from '@/utils/logger';

export type DependencyStatus = 'up' | 'down' | 'timeout';

export interface HealthReport {
  healthy: boolean;
  checks: {
    database: DependencyStatus;
    horizon: DependencyStatus;
  };
}

/**
 * Probes every dependency the API needs. Each probe is bounded by
 * `timeoutMs`, so the endpoint answers quickly even when Horizon hangs.
 * Failure details go to the log; the report carries only status words.
 */
export async function checkHealth(timeoutMs = config.health.timeoutMs): Promise<HealthReport> {
  // SQLite runs in-process and answers SELECT 1 synchronously, so the database
  // probe needs no timer. A wedged disk would block the event loop, which the
  // load balancer would see as a missed response anyway.
  const database: DependencyStatus = isDatabaseHealthy() ? 'up' : 'down';
  if (database === 'down') logger.warn('Health: database probe failed');

  const horizonStatus = await probeHorizonStatus(timeoutMs);

  return {
    healthy: database === 'up' && horizonStatus === 'up',
    checks: { database, horizon: horizonStatus },
  };
}

async function probeHorizonStatus(timeoutMs: number): Promise<DependencyStatus> {
  try {
    await horizon.probeHorizon(timeoutMs);
    return 'up';
  } catch (err) {
    const name = (err as Error).name;
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    const reason = timedOut ? 'timed out' : 'failed';
    logger.warn(`Health: Horizon probe ${reason}: ${(err as Error).message}`);
    return timedOut ? 'timeout' : 'down';
  }
}
