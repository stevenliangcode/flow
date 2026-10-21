import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Locks down the built page (dev is left alone so Vite's hot reload keeps working). */
const contentSecurityPolicy: Plugin = {
  name: 'flow-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'" />`,
    ),
};

export default defineConfig({
  root: 'web',
  // Relative asset paths, so the desktop app can load the build from disk.
  base: './',
  plugins: [react(), contentSecurityPolicy],
  // `npm run dev` loads the UI from here; electron/main.ts expects this exact port.
  server: {
    port: 5173,
    strictPort: true,
  },
});
