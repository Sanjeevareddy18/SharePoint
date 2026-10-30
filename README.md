# Runtime-signed Hosted Exchange Web SDK

This starter uses the Runtime-signed Hosted Exchange flow: the customer backend authenticates the user and asks Runtime to mint a short-lived bootstrap token. The browser receives only that token; it never receives the Hosted Exchange channel secret.

## 1. Configure Studio

In the SDK channel settings:

1. Set the auth mode to `hosted_exchange`.
2. Bind the channel to the intended deployment and allowlist the exact HTTPS browser origins.
3. Choose `sdkTokenEnvelopePolicy`:
   - `jwe_preferred` is a suitable rollout default; Runtime uses JWE when supported.
   - `jwe_required` fails closed and should be selected only after the Runtime capability check confirms JWE issue and verify support.
   - `signed` keeps signed-token compatibility.
4. Copy the channel server secret into your backend secret manager. Never put it in browser code.

## 2. Configure the customer backend

Copy `.env.example` to your environment configuration and replace its example values. Keep `ARTEMIS_SDK_CHANNEL_SECRET` in a secret manager, not in source control.

Install Express if the host application does not already use it:

```sh
npm install express
```

Run the backend on Node.js 18.17 or newer.

Mount the router after configuring the application's customer-session authentication middleware:

```js
import express from 'express';
import { createArtemisBootstrapRouter } from './server/artemis-bootstrap.mjs';
import { requireCustomerSession } from './your-customer-auth.mjs';

const app = express();
app.use(createArtemisBootstrapRouter({ requireCustomerSession }));
```

`requireCustomerSession` must authenticate the request and attach the verified customer as `req.customer`, with a stable string `id`. The example forwards only server-derived `plan` and `region` attributes; adjust that allowlist to match your application and keep the total attributes within Runtime's SDK token size limits.

Protect this endpoint with the same authentication and CSRF controls as other cookie-authenticated POST routes. Use HTTPS, secure cookies, rate limiting, and do not log bootstrap tokens or secure attributes.

## 3. Initialize the browser SDK

Install `@koreai/artemis-web-sdk` in the browser application's existing package setup, then import `connectArtemisChat` from `web/artemis-chat.mjs`:

```js
import { connectArtemisChat } from './artemis-chat.mjs';

const sdk = await connectArtemisChat({
  endpoint: 'https://runtime.example.com',
  projectId: 'project_123',
});
```

For a Hosted Exchange SDK config, do not add `apiKey`, `channelId`, `channelName`, `deploymentSlug`, or browser `userContext`. Runtime resolves channel details from the bootstrap token. Use `sessionMetadata` only for non-identity browser context if needed.

The provider fetches a fresh token for each SDK initialization and treats backend failures as startup failures. Do not persist bootstrap tokens in local storage.

## 4. Verify the setup

1. Sign in to the customer application from an allowlisted origin.
2. Confirm `POST /api/artemis/bootstrap` authenticates the customer and calls Runtime's `POST /api/v1/sdk/customer-sessions`.
3. Confirm the browser SDK initializes using the returned token and does not send `X-Public-Key`.
4. Confirm a replayed bootstrap token is rejected and the SDK can refresh and obtain a WebSocket ticket.
5. If using `jwe_required`, verify Runtime JWE capability before enabling the policy.
