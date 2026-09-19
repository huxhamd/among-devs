import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import packageInfo from './package.json';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __APP_VERSION__: JSON.stringify(packageInfo.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
  }
});
