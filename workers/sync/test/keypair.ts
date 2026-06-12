/** TEST-ONLY Ed25519 keypair (same fixture as the keys service's test suite;
 *  never deployed — production pins the real key from keys.alpacasoft.dev).
 *  Standalone module so both vitest.config.ts (Node) and the in-worker test
 *  helpers can import it without dragging each other's runtime along. */
export const TEST_PRIVATE_KEY_PKCS8_B64 =
  "MC4CAQAwBQYDK2VwBCIEID7nr4UzKhzXovSzDkFt/COcOMpRY2M648hzS7YUp5Jn";
export const TEST_PUBLIC_KEY_B64URL = "aGUyp7LBUp9yhPI37WegLdkq34HCKbNiEZ1bhPnOMTo";
