process.env.NODE_ENV = "test";
process.env.APP_ORIGIN ??= "http://localhost:5173";
process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "unit-test-session-secret-that-is-long-enough";
process.env.PRIMARY_APP_PUBLIC_KEY ??= "test-public-key";
