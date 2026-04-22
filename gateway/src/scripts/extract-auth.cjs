const fs = require('fs');
const path = require('path');

const pluginFile = path.join(__dirname, '../plugin.ts');
const targetFile = path.join(__dirname, '../plugin/auth-flow.ts');

const lines = fs.readFileSync(pluginFile, 'utf8').split('\n');

const startStr = 'authorize: async (inputs?: Record<string, string>) => {';

let startLine = -1;
let endLine = -1;

for (let i = 1500; i < lines.length; i++) {
  if (lines[i].includes(startStr)) {
    startLine = i;
  }
  if (startLine !== -1 && i > startLine && lines[i].includes('label: "Manually enter API Key",')) {
    endLine = i - 2; 
    break;
  }
}

console.log('Found block:', startLine, 'to', endLine);

if (startLine === -1 || endLine === -1) {
    console.error('Could not find authorize block');
    process.exit(1);
}

const authorizeLines = lines.slice(startLine + 1, endLine);

const newFileContent = `import { authorizeGoogleGemini, exchangeGoogleGemini, type AlloyTokenExchangeResult } from "../google-gemini/oauth";
import { parseRefreshParts } from "./auth";
import { promptAddAnotherAccount, promptLoginMode, promptProjectId } from "./cli";
import { checkAccountsQuota } from "./quota";
import { startOAuthListener, type OAuthListener } from "./server";
import { clearAccounts, loadAccounts, saveAccounts } from "./storage";
import { persistAccountPool } from "./persist-account-pool";
import { formatWaitTime } from "./core/rate-limit-state";
import { shouldSkipLocalServer, openBrowser } from "./core/system-utils";
import { createLogger } from "./logger";
import type { PluginClient } from "./types";

const log = createLogger("auth-flow");

const MAX_OAUTH_ACCOUNTS = 10;

async function promptOAuthCallbackValue(message: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

type OAuthCallbackParams = { code: string; state: string };

function getStateFromAuthorizationUrl(authorizationUrl: string): string {
  try {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  } catch {
    return "";
  }
}

function extractOAuthCallbackParams(url: URL): OAuthCallbackParams | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

function parseOAuthCallbackInput(
  value: string,
  fallbackState: string,
): OAuthCallbackParams | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "Missing authorization code" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? fallbackState;

    if (!code) {
      return { error: "Missing code in callback URL" };
    }
    if (!state) {
      return { error: "Missing state in callback URL" };
    }

    return { code, state };
  } catch {
    if (!fallbackState) {
      return { error: "Missing state. Paste the full redirect URL instead of only the code." };
    }

    return { code: trimmed, state: fallbackState };
  }
}

async function promptManualOAuthInput(
  fallbackState: string,
): Promise<AlloyTokenExchangeResult> {
  console.log("1. Open the URL above in your browser and complete Google sign-in.");
  console.log("2. After approving, copy the full redirected localhost URL from the address bar.");
  console.log("3. Paste it back here.\\n");

  const callbackInput = await promptOAuthCallbackValue(
    "Paste the redirect URL (or just the code) here: ",
  );
  const params = parseOAuthCallbackInput(callbackInput, fallbackState);
  if ("error" in params) {
    return { type: "failed", error: params.error };
  }

  return exchangeGoogleGemini(params.code, params.state);
}

export async function executeAlloyAuthFlow(
  inputs: Record<string, string> | undefined,
  client: PluginClient,
  providerId: string
) {
${authorizeLines.join('\n')}
}
`;

fs.writeFileSync(targetFile, newFileContent);

let startRemoveFunc = -1;
let endRemoveFunc = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('async function promptOAuthCallbackValue')) {
    startRemoveFunc = i;
  }
  if (startRemoveFunc !== -1 && lines[i].includes('export const createAlloyPlugin')) {
    endRemoveFunc = i - 6; 
    break;
  }
}

const newPluginLines = [];

for (let i = 0; i < lines.length; i++) {
  if (i >= startRemoveFunc && i <= endRemoveFunc) {
      continue;
  }

  if (i === startLine) {
    newPluginLines.push('        authorize: async (inputs?: Record<string, string>) => {');
    newPluginLines.push('          const { executeAlloyAuthFlow } = await import("./plugin/auth-flow");');
    newPluginLines.push('          return executeAlloyAuthFlow(inputs, client, providerId);');
    newPluginLines.push('        },');
    i = endLine;
    continue;
  }

  newPluginLines.push(lines[i]);
}

fs.writeFileSync(pluginFile, newPluginLines.join('\n'));

console.log('Successfully extracted auth flow');
