/**
 * @obikai/api-client — shared browser API client (token + transparent refresh) for the web apps.
 * Framework-free; the base URL is injected via `configureApiBase` so there is no bundler coupling.
 */
export {
  api,
  ApiError,
  changePassword,
  configureApiBase,
  confirmEmailVerification,
  confirmPasswordReset,
  getAccessToken,
  login,
  logout,
  refresh,
  requestEmailVerification,
  requestPasswordReset,
  setAccessToken,
  setOnAuthLost,
  type LoginResult,
} from './client.js';
