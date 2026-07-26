// This app is zoneless (no zone.js dependency, no zone change-detection
// provider), so the test environment must be initialized the same way.
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import {
  serialize as v8Serialize,
  deserialize as v8Deserialize,
} from 'node:v8';

setupZonelessTestEnv();

// jsdom (jest-environment-jsdom) does not expose the standard `structuredClone`
// global, which fake-indexeddb@6 requires to clone values on write/read. Provide
// it here for every portal spec, using v8 structured serialization (true
// structured-clone semantics). Guarded with `??=` so a real implementation — in
// any future/updated environment that ships one — always wins.
const globalWithClone = globalThis as unknown as {
  structuredClone?: <T>(value: T) => T;
};
globalWithClone.structuredClone ??= <T>(value: T): T =>
  v8Deserialize(v8Serialize(value)) as T;
