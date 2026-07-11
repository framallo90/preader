import { defineConfig } from 'vitest/config';

// Tests de lógica pura (sin React Native ni módulos nativos). Corren en Node,
// no tocan el bundle de Expo. `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
