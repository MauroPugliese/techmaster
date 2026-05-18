// =============================================================================
// environment.prod.ts  — Production / Docker
// Used by:  ng build --configuration production
//
// IMPORTANT: The string "__API_URL__" is a build-time placeholder.
// The Dockerfile runs `sed` to replace it with the real value of the
// API_URL build argument before `ng build` executes.
//
// When Nginx proxies /api/* internally (same origin), set this to just '/api'
// so no absolute host is baked into the bundle — works behind any domain.
//
// Example docker build override:
//   docker build --build-arg API_URL=/api .
// =============================================================================
export const environment = {
  production: true,

  // Replaced at Docker build time via:
  //   sed -i "s|__API_URL__|${API_URL}|g" environment.prod.ts
  // Default value used when building outside Docker:
  apiUrl: '__API_URL__',

  appName: 'TechManager',
  version: '1.0.0',
};
