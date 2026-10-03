# Primary app integration

The primary Saference backend creates a signed identity assertion when an authenticated customer opens Support. The primary app sends no password, banking credential, PIN, access token, or account balance to the support system.

## Required customer details

The assertion is an EdDSA JWT with these claims:

| Claim | Required | Meaning |
| --- | --- | --- |
| `iss` | yes | `safer-primary` |
| `aud` | yes | `safer-support` |
| `sub` | yes | Stable, non-recycled customer UID from the primary app |
| `jti` | yes | Unique random ID; every assertion can be exchanged once |
| `iat` | yes | Issued-at time |
| `exp` | yes | Expiry, recommended 2 minutes and never over 5 minutes |
| `name` | yes | Verified display name, 1–120 characters |
| `email` | no | Verified contact email |
| `avatarUrl` | no | Private or appropriately authorized avatar URL |
| `profileVersion` | recommended | Monotonic integer; prevents stale profile data overwriting newer data |
| `accountStatus` | recommended | `active`, `restricted`, or `revoked` |

Keep the Ed25519 private key only in the primary app backend. Configure its public key as `PRIMARY_APP_PUBLIC_KEY` in Safer Support.

## Node.js signing example

```js
import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

const key = await importPKCS8(process.env.SUPPORT_IDENTITY_PRIVATE_KEY, "EdDSA");

export async function createSupportAssertion(customer) {
  return new SignJWT({
    name: customer.verifiedName,
    email: customer.verifiedEmail,
    avatarUrl: customer.avatarUrl,
    profileVersion: customer.profileVersion,
    accountStatus: customer.status
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer("safer-primary")
    .setAudience("safer-support")
    .setSubject(customer.uid)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(key);
}
```

## Exchange and launch

The browser posts the assertion once:

```http
POST /api/v1/identity/exchange
Content-Type: application/json

{"assertion":"eyJ..."}
```

The response contains a 15-minute access token, a rotating refresh token, and the canonical support customer. Hold the access token in memory. Store the refresh token in the primary app's secure session layer or an HttpOnly, Secure, SameSite cookie controlled by that app. Do not put either token in a URL.

Use the access token as `Authorization: Bearer <token>` for REST calls and as Socket.IO `auth.token`. On reconnect, call `GET /api/v1/conversations/{id}/messages?after=<lastSequence>` before resuming live events.

## Isolation contract

The support service may receive the stable UID and the profile fields above. It must not receive card data, banking PINs, transaction signing secrets, primary refresh tokens, or unrestricted primary-app API credentials. A support outage must not block login or banking features in the primary app.
