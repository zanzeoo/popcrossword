import Redis from 'ioredis';

// Toutes les clés sont préfixées (« pc: » par défaut) : les tests utilisent un autre préfixe.
export const REDIS_PREFIX = process.env.REDIS_PREFIX ?? 'pc:';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 3,
  keyPrefix: REDIS_PREFIX,
});
