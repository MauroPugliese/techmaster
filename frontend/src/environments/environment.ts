// =============================================================================
// environment.ts  — Development
// Used by:  ng serve / ng build (default)
// API points to the backend running locally on port 3000.
// =============================================================================
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  appName: 'TechManager',
  version: '1.0.0',
};
