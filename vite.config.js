import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createBkeProjectService } from './server/bke-project-service.js';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

function bkeProjectPlugin() {
  return {
    name: 'bke-project-assets',
    configureServer(server) {
      const service = createBkeProjectService({
        toolRoot,
        sampleProjectRoot: path.join(toolRoot, 'sample_project'),
        settingsPath: path.join(toolRoot, '.bke-layout-preview.json'),
      });
      server.middlewares.use(async (req, res, next) => {
        if (await service.handleApi(req, res)) return;
        next();
      });
    },
  };
}

export default defineConfig({
  root: toolRoot,
  plugins: [bkeProjectPlugin()],
  build: {
    rollupOptions: {
      input: {
        index: path.join(toolRoot, 'index.html'),
      },
    },
  },
  server: {
    port: 5177,
    strictPort: false,
    fs: {
      allow: [toolRoot],
    },
  },
  preview: {
    port: 4177,
  },
});
