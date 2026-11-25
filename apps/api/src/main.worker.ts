import { createWorker } from './create-worker.js';
import { loadConfig } from './kernel/config/app-config.js';
import { loadLocalEnv } from './kernel/config/local-env.js';

loadLocalEnv();
const worker = await createWorker(loadConfig());
await worker.init();
