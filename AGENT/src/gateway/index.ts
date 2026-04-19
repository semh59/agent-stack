/**
 * Gateway Module — Barrel Export
 *
 * Tüm gateway bileşenlerini tek noktadan export eder.
 */

export { startGateway, type GatewayOptions } from "./gateway";
export { AuthServer, type AuthServerOptions, type AuthResult } from "./auth-server";
export { TokenStore, type StoredToken, type TokenStoreData } from "./token-store";
export { launchOAuthBrowser, generateOAuthUrl, type LaunchResult } from "./browser-launcher";
export { performHandoff, type HandoffOptions, type HandoffResult } from "./agent-handoff";
