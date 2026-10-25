import { register } from 'node:module';

register('./loader-hooks.js', import.meta.url);
