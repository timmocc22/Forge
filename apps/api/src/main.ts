import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './config.js';

const app = await createApp();
const config = app.get<AppConfig>(APP_CONFIG);
await app.listen(config.PORT, '127.0.0.1');
console.log(`Forge API: http://127.0.0.1:${config.PORT} (${config.PROVIDER})`);
