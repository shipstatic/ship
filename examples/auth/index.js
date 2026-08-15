/**
 * Ship SDK — the credential slot.
 *
 * The platform issues more than one kind of credential, and they all travel
 * the same way: one `token` option, sent verbatim as `Authorization: Bearer`.
 * The value's PREFIX says which population it belongs to, and the server
 * classifies it — so a client never has to declare what it is holding, and
 * there is no precedence to reason about.
 *
 *   ship-…    API key       durable, full account access
 *   deploy-…  deploy token  scoped to deploys, revocable, optional TTL
 *   oauth-…   access token  delegated, short-lived
 *
 * Run with:  pnpm start
 */
import Ship from '@shipstatic/ship';

// Well-formed but deliberately not real. The SDK checks a credential's SHAPE
// at the boundary; only the server can say whether one is genuine. Building
// these at runtime keeps anything key-shaped out of the source.
const sampleApiKey = `ship-${'0'.repeat(32)}`;
const sampleDeployToken = `deploy-${'0'.repeat(32)}`;

// ---------------------------------------------------------------------------
// 1. One slot, any population
// ---------------------------------------------------------------------------
// Nothing at the call site says which kind of credential this is. There is no
// `apiKey` option and no `deployToken` option — there never has to be.

new Ship({ token: sampleApiKey });
new Ship({ token: sampleDeployToken });

console.log('1. One `token` slot accepts every population.');

// ---------------------------------------------------------------------------
// 2. No token at all
// ---------------------------------------------------------------------------
// Deploys still work: the site lands in the public account with a claim URL
// and an expiry. Every OTHER operation requires a credential.
//
// In Node the SDK also reads SHIP_TOKEN from the environment, so this is the
// shape most programs want — the credential stays out of the source entirely.

new Ship({});

console.log('2. No credential — deploys are public and claimable.');
console.log(`   SHIP_TOKEN is ${process.env.SHIP_TOKEN ? 'set' : 'not set'}.`);

// ---------------------------------------------------------------------------
// 3. Rotating a credential at runtime
// ---------------------------------------------------------------------------
// One setter, accepting any population for the same reason the constructor
// does. It takes effect on the next request; the client is not rebuilt.

const rotating = new Ship({ token: sampleApiKey });
rotating.setToken(sampleDeployToken);

console.log('3. setToken() swaps the credential on a live client.');

// ---------------------------------------------------------------------------
// 4. Minting a credential per request — the TokenProvider
// ---------------------------------------------------------------------------
// Pass a FUNCTION instead of a string when the credential must be minted or
// refreshed. The SDK calls it for each request, so expiry and renewal stay
// with the caller that knows the rules. It is never called here — no request
// is made — which is itself the point: the credential is fetched when it is
// needed, not when the client is built.
//
// This is where short-lived credentials belong, by the SDK's lifetime rule:
// storage must not outlive the credential. A dotfile is indefinite, so it
// holds durable tokens; a process environment lives as long as the process;
// a provider is per request, which is the only honest home for an hourly
// OAuth access token.

let cached = null;
let expiresAt = 0;

async function getAccessToken() {
  if (cached && Date.now() < expiresAt) return cached;

  // Replace with a real exchange — a refresh-token grant, a vault read, an
  // internal minting service. Returning a string is the whole contract.
  cached = `oauth-${'0'.repeat(32)}`;
  expiresAt = Date.now() + 55 * 60 * 1000;

  return cached;
}

new Ship({ token: getAccessToken });

console.log('4. A TokenProvider mints/refreshes per request.');

// ---------------------------------------------------------------------------
// 5. What the slot refuses, and where
// ---------------------------------------------------------------------------
// Format is checked on the client, so a malformed credential fails before a
// request is made rather than after a round trip. The same rules run on the
// server, which is the boundary that actually matters — the client copy is
// for speed, not for security.

// Note the middle case. A value carrying NO known prefix is not malformed —
// it is the opaque population (a pre-issued bearer the platform did not mint),
// so it rides the slot untouched and the server is what refuses it. Only a
// value claiming a population it does not fit is rejected here.
for (const candidate of ['ship-your-api-key', 'nonsense', `ship-${'z'.repeat(32)}`]) {
  try {
    new Ship({ token: candidate });
    console.log(`5. ${JSON.stringify(candidate)} => accepted (opaque bearer, server decides)`);
  } catch (error) {
    console.log(`5. ${JSON.stringify(candidate)} => ${error.message}`);
  }
}

// An empty string is ABSENCE of intent, not a credential — it is what an unset
// shell variable expands to, so the constructor lets it fall through to
// SHIP_TOKEN instead of locking in a phantom. `setToken('')` is different: an
// explicit instruction that cannot be satisfied, so it throws.
new Ship({ token: '' });
console.log('6. Constructor: `token: ""` is absence — falls through.');

try {
  rotating.setToken('');
} catch (error) {
  console.log(`6. setToken("") => ${error.message}`);
}
