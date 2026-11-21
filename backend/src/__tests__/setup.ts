// Deterministic config so tests never touch a real project or read a local .env.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-32";
process.env.CODE_PEPPER = "test-code-pepper-that-is-long-enough-32ch";
process.env.NODE_ENV = "test";
