import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "../src/config/env.js";
import { sendStaffCredentials } from "../src/modules/email/cloudflare.js";

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "https://support.saference.com";
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.SESSION_SECRET = "unit-test-session-secret-that-is-long-enough";
  process.env.PRIMARY_APP_PUBLIC_KEY = "test-public-key";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "test-email-token";
  process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID = "account-123";
  process.env.EMAIL_FROM = "support@saference.com";
  process.env.SUPPORT_APP_URL = "https://support.saference.com";
  resetEnvForTests();
});

describe("Cloudflare staff credential email", () => {
  it("sends the generated credentials through the scoped email endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { message_id: "message-123" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStaffCredentials({
      name: "Ada Agent",
      email: "ada@example.com",
      password: "temporary-password-value",
      role: "agent",
    })).resolves.toEqual({ messageId: "message-123" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/account-123/email/sending/send");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-email-token" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      to: "ada@example.com",
      from: "support@saference.com",
      subject: "Your Safer Support account is ready",
    });
    expect(body.text).toContain("temporary-password-value");
    expect(body.html).toContain("https://support.saference.com");
    expect(body.html).toContain("https://media.saference.com/branding/safer-email-logo.png");
    expect(body.html).toContain("KEEP YOUR ACCOUNT SECURE");
  });

  it("fails closed when Cloudflare rejects delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ message: "Delivery rejected" }],
    }), { status: 400, headers: { "content-type": "application/json" } })));

    await expect(sendStaffCredentials({
      name: "Ada Agent",
      email: "ada@example.com",
      password: "temporary-password-value",
      role: "agent",
    })).rejects.toEqual(expect.objectContaining({
      status: 502,
      code: "email_delivery_failed",
    }));
  });
});
