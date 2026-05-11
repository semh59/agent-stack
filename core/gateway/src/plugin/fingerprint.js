"use strict";
/**
 * Device Fingerprint Generator for Rate Limit Mitigation
 *
 * Ported from Alloy-claude-proxy PR #170
 * https://github.com/badrisnarayanan/Alloy-claude-proxy/pull/170
 *
 * Generates randomized device fingerprints to help distribute API usage
 * across different apparent device identities.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FINGERPRINT_HISTORY = void 0;
exports.generateFingerprint = generateFingerprint;
exports.collectCurrentFingerprint = collectCurrentFingerprint;
exports.buildFingerprintHeaders = buildFingerprintHeaders;
exports.getSessionFingerprint = getSessionFingerprint;
exports.regenerateSessionFingerprint = regenerateSessionFingerprint;
const crypto = __importStar(require("node:crypto"));
const os = __importStar(require("node:os"));
const constants_1 = require("../constants");
const OS_VERSIONS = {
    darwin: ["10.15.7", "11.6.8", "12.6.3", "13.5.2", "14.2.1", "14.5"],
    win32: ["10.0.19041", "10.0.19042", "10.0.19043", "10.0.22000", "10.0.22621", "10.0.22631"],
    linux: ["5.15.0", "5.19.0", "6.1.0", "6.2.0", "6.5.0", "6.6.0"],
};
const ARCHITECTURES = ["x64", "arm64"];
const IDE_TYPES = [
    "IDE_UNSPECIFIED",
    "VSCODE",
    "INTELLIJ",
    "ANDROID_STUDIO",
    "CLOUD_SHELL_EDITOR",
];
const PLATFORMS = [
    "PLATFORM_UNSPECIFIED",
    "WINDOWS",
    "MACOS",
    "LINUX",
];
const SDK_CLIENTS = [
    "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "google-cloud-sdk vscode/1.86.0",
    "google-cloud-sdk vscode/1.87.0",
    "google-cloud-sdk intellij/2024.1",
    "google-cloud-sdk android-studio/2024.1",
    "gcloud-python/1.2.0 grpc-google-iam-v1/0.12.6",
];
/** Maximum number of fingerprint versions to keep per account */
exports.MAX_FINGERPRINT_HISTORY = 5;
function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function generateDeviceId() {
    return crypto.randomUUID();
}
function generateSessionToken() {
    return crypto.randomBytes(16).toString("hex");
}
/**
 * Generate a randomized device fingerprint.
 * Each fingerprint represents a unique "device" identity.
 */
function generateFingerprint() {
    const platform = randomFrom(["darwin", "win32", "linux"]);
    const arch = randomFrom(ARCHITECTURES);
    const osVersion = randomFrom(OS_VERSIONS[platform] ?? OS_VERSIONS.linux);
    const matchingPlatform = platform === "darwin"
        ? "MACOS"
        : platform === "win32"
            ? "WINDOWS"
            : platform === "linux"
                ? "LINUX"
                : randomFrom(PLATFORMS);
    return {
        deviceId: generateDeviceId(),
        sessionToken: generateSessionToken(),
        userAgent: `Alloy/${constants_1.ALLOY_VERSION} ${platform}/${arch}`,
        apiClient: randomFrom(SDK_CLIENTS),
        clientMetadata: {
            ideType: randomFrom(IDE_TYPES),
            platform: matchingPlatform,
            pluginType: "GEMINI",
            osVersion: osVersion,
            arch: arch,
            sqmId: `{${crypto.randomUUID().toUpperCase()}}`,
        },
        quotaUser: `device-${crypto.randomBytes(8).toString("hex")}`,
        createdAt: Date.now(),
    };
}
/**
 * Collect fingerprint based on actual current system.
 * Uses real OS info instead of randomized values.
 */
function collectCurrentFingerprint() {
    const platform = os.platform();
    const arch = os.arch();
    const osRelease = os.release();
    const matchingPlatform = platform === "darwin"
        ? "MACOS"
        : platform === "win32"
            ? "WINDOWS"
            : platform === "linux"
                ? "LINUX"
                : "PLATFORM_UNSPECIFIED";
    return {
        deviceId: generateDeviceId(),
        sessionToken: generateSessionToken(),
        userAgent: `Alloy/${constants_1.ALLOY_VERSION} ${platform}/${arch}`,
        apiClient: "google-cloud-sdk vscode_cloudshelleditor/0.1",
        clientMetadata: {
            ideType: "VSCODE",
            platform: matchingPlatform,
            pluginType: "GEMINI",
            osVersion: osRelease,
            arch: arch,
            sqmId: `{${crypto.randomUUID().toUpperCase()}}`, // Session-specific for current device
        },
        quotaUser: `device-${crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16)}`,
        createdAt: Date.now(),
    };
}
/**
 * Build HTTP headers from a fingerprint object.
 * These headers are used to identify the "device" making API requests.
 */
function buildFingerprintHeaders(fingerprint) {
    if (!fingerprint) {
        return {};
    }
    return {
        "User-Agent": fingerprint.userAgent,
        "X-Goog-Api-Client": fingerprint.apiClient,
        "Client-Metadata": JSON.stringify(fingerprint.clientMetadata),
        "X-Goog-QuotaUser": fingerprint.quotaUser,
        "X-Client-Device-Id": fingerprint.deviceId,
    };
}
/**
 * Session-level fingerprint instance.
 * Generated once at module load, persists for the lifetime of the process.
 */
let sessionFingerprint = null;
/**
 * Get or create the session fingerprint.
 * Returns the same fingerprint for all calls within a session.
 */
function getSessionFingerprint() {
    if (!sessionFingerprint) {
        sessionFingerprint = generateFingerprint();
    }
    return sessionFingerprint;
}
/**
 * Regenerate the session fingerprint.
 * Call this to get a fresh identity (e.g., after rate limiting).
 */
function regenerateSessionFingerprint() {
    sessionFingerprint = generateFingerprint();
    return sessionFingerprint;
}
//# sourceMappingURL=fingerprint.js.map