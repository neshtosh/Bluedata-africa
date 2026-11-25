import { createApp } from './create-app.js';
import { loadConfig } from './kernel/config/app-config.js';
import { loadLocalEnv } from './kernel/config/local-env.js';

loadLocalEnv();
const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.PORT, host: '0.0.0.0' });
