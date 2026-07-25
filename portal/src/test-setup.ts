// This app is zoneless (no zone.js dependency, no zone change-detection
// provider), so the test environment must be initialized the same way.
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv();
