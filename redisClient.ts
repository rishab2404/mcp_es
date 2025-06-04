import pkg from "ioredis";
const Redis = (pkg as any).default || pkg;

const {
  REDIS_URL,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD
} = process.env;

const redis = REDIS_URL
  ? new Redis(REDIS_URL)
  : new Redis({
      host: REDIS_HOST || "localhost",
      port: REDIS_PORT ? Number(REDIS_PORT) : 6379,
      password: REDIS_PASSWORD || undefined,
    });

export default redis;
