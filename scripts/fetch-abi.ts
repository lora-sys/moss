import process from "node:process";

const API_URL = "https://api.etherscan.io/v2/api";
const USAGE = "Usage: pnpm fetch-abi <address> <exportName>";
const HELP = `${USAGE}

Fetch a verified Monad mainnet ABI from Etherscan V2 and print typed TypeScript.

Environment:
  MONADSCAN_API_KEY  Required Etherscan API key
`;

export interface RunResult {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

interface Options {
  address: string;
  exportName: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(exitCode: 1 | 2, message: string, key?: string): RunResult {
  return {
    exitCode,
    stdout: "",
    stderr: `fetch-abi: ${redact(message, key)}\n`,
  };
}

function redact(message: string, key?: string): string {
  if (!key) return message;
  const encodedKey = new URLSearchParams({ key }).toString().slice("key=".length);
  return message.replaceAll(key, "[REDACTED]").replaceAll(encodedKey, "[REDACTED]");
}

function parseArgs(argv: string[]): Options | string {
  if (argv.length !== 2) return USAGE;
  const [address, exportName] = argv;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return "address must be a 20-byte hex value";
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    return "exportName must be a TypeScript identifier";
  }
  return { address, exportName };
}

function apiUrl(address: string, key: string): string {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    chainid: "143",
    module: "contract",
    action: "getabi",
    address,
    apikey: key,
  }).toString();
  return url.toString();
}

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  dependencies: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<RunResult> {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }

  const parsed = parseArgs(argv);
  if (typeof parsed === "string") return failure(1, parsed);

  const key = env.MONADSCAN_API_KEY;
  if (!key) {
    return failure(
      1,
      "MONADSCAN_API_KEY is not set; create one at https://info.monadscan.com/myapikey/ and export it.",
    );
  }

  let response: Response;
  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(apiUrl(parsed.address, key), {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return failure(
      2,
      `network failure fetching ABI for ${parsed.address}: ${errorMessage(error)}`,
      key,
    );
  }

  if (!response.ok) {
    return failure(2, `Monadscan API returned HTTP ${response.status} for ${parsed.address}`, key);
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    return failure(
      2,
      `Monadscan returned a non-JSON body for ${parsed.address}: ${errorMessage(error)}`,
      key,
    );
  }

  if (!envelope || typeof envelope !== "object") {
    return failure(2, `Monadscan returned an invalid API envelope for ${parsed.address}`, key);
  }
  const { status, message, result } = envelope as Record<string, unknown>;
  if (status !== "1") {
    const reason =
      typeof result === "string" ? result : typeof message === "string" ? message : "unknown error";
    return failure(2, `Monadscan API refused ${parsed.address}: ${reason}`, key);
  }
  if (typeof result !== "string") {
    return failure(2, `Monadscan returned a non-string result for ${parsed.address}`, key);
  }

  let abi: unknown;
  try {
    abi = JSON.parse(result);
  } catch (error) {
    return failure(
      2,
      `Monadscan returned malformed ABI JSON for ${parsed.address}: ${errorMessage(error)}`,
      key,
    );
  }
  if (!Array.isArray(abi)) {
    return failure(2, `Monadscan result for ${parsed.address} is not an ABI array`, key);
  }

  const stdout = [
    "// ABI origin: explorer (ADR 0007)",
    `//   Source:    https://monadscan.com/address/${parsed.address}`,
    "//   Endpoint:  Etherscan V2 (chainid=143, module=contract, action=getabi)",
    `//   Retrieved: ${(dependencies.now?.() ?? new Date()).toISOString().slice(0, 10)} (UTC)`,
    "",
    `export const ${parsed.exportName}Abi = ${JSON.stringify(abi, null, 2)} as const;`,
    "",
  ].join("\n");
  return { exitCode: 0, stdout, stderr: "" };
}

export async function main(): Promise<void> {
  const result = await run(process.argv.slice(2), process.env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
