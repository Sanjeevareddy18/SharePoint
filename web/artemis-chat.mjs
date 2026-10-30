import { AgentSDK } from '@koreai/artemis-web-sdk';

export function createArtemisSDK({
  endpoint,
  projectId,
  bootstrapEndpoint = '/api/artemis/bootstrap',
}) {
  if (!endpoint || !projectId) {
    throw new Error('Artemis endpoint and projectId are required');
  }

  return new AgentSDK({
    endpoint,
    projectId,
    bootstrapTokenProvider: async () => {
      const response = await fetch(bootstrapEndpoint, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Unable to start chat');
      }

      const body = await response.json();
      if (typeof body.bootstrapToken !== 'string' || !body.bootstrapToken) {
        throw new Error('Bootstrap endpoint returned an invalid response');
      }

      return body.bootstrapToken;
    },
  });
}

export async function connectArtemisChat(config) {
  const sdk = createArtemisSDK(config);
  await sdk.connect();
  return sdk;
}
