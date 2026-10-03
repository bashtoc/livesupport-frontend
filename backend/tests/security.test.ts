import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

let tokens: typeof import("../src/modules/auth/tokens.js");
let secrets: typeof import("../src/lib/secrets.js");
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  privateKey = pair.privateKey;
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://localhost:5173";
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.SESSION_SECRET = "unit-test-session-secret-that-is-long-enough";
  process.env.PRIMARY_APP_PUBLIC_KEY = await exportSPKI(pair.publicKey);
  tokens = await import("../src/modules/auth/tokens.js");
  secrets = await import("../src/lib/secrets.js");
});

describe("support security boundaries", () => {
  it("round-trips encrypted MFA secrets without storing plaintext", () => {
    const ciphertext = secrets.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(ciphertext).not.toContain("JBSWY3DPEHPK3PXP");
    expect(secrets.decryptSecret(ciphertext)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("signs and verifies customer access tokens", async () => {
    const token = await tokens.signAccessToken(
      { type: "customer", id: "a4f64717-9045-4e7b-99c6-798ea8e04d27", externalUid: "customer_123" },
      "5m"
    );
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
      type: "customer",
      id: "a4f64717-9045-4e7b-99c6-798ea8e04d27",
      externalUid: "customer_123"
    });
  });

  it("accepts a short-lived primary-app assertion with required claims", async () => {
    const assertion = await new SignJWT({ name: "Ada Customer", profileVersion: 3, accountStatus: "active" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("safer-primary")
      .setAudience("safer-support")
      .setSubject("primary-user-42")
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(privateKey);
    await expect(tokens.verifyIdentityAssertion(assertion)).resolves.toMatchObject({
      sub: "primary-user-42",
      name: "Ada Customer",
      profileVersion: 3
    });
  });

  it("rejects assertions from an untrusted issuer", async () => {
    const assertion = await new SignJWT({ name: "Mallory" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("unknown-app")
      .setAudience("safer-support")
      .setSubject("attacker")
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(privateKey);
    await expect(tokens.verifyIdentityAssertion(assertion)).rejects.toMatchObject({
      status: 401,
      code: "invalid_identity_assertion"
    });
  });
});
