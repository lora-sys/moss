import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type RunResult, run } from "./fetch-abi.ts";

const ADDRESS = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const KEY = "test-monadscan-api-key-DO-NOT-USE";
const SPECIAL_KEY = "secret/key";
const ENCODED_SPECIAL_KEY = new URLSearchParams({ apikey: SPECIAL_KEY })
  .toString()
  .slice("apikey=".length);
const NOW = new Date("2026-07-19T00:00:00Z");
const ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
];

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function call(
  args: string[],
  env: NodeJS.ProcessEnv = { MONADSCAN_API_KEY: KEY },
  fetchImpl: typeof fetch = async () =>
    response({ status: "1", message: "OK", result: JSON.stringify(ABI) }),
): Promise<RunResult> {
  return run(args, env, { fetch: fetchImpl, now: () => NOW });
}

test("emits the full typed explorer ABI and calls the official endpoint", async () => {
  let requestUrl = "";
  const result = await call([ADDRESS, "wmon"], undefined, async (input) => {
    requestUrl = String(input);
    return response({ status: "1", message: "OK", result: JSON.stringify(ABI) });
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /ABI origin: explorer \(ADR 0007\)/);
  assert.match(result.stdout, new RegExp(`Source: +https://monadscan\\.com/address/${ADDRESS}`));
  assert.match(result.stdout, /Retrieved: 2026-07-19 \(UTC\)/);
  assert.ok(result.stdout.includes(JSON.stringify(ABI, null, 2)));
  assert.ok(result.stdout.endsWith(" as const;\n"));

  const url = new URL(requestUrl);
  assert.equal(url.origin + url.pathname, "https://api.etherscan.io/v2/api");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    chainid: "143",
    module: "contract",
    action: "getabi",
    address: ADDRESS,
    apikey: KEY,
  });
});

test("rejects invalid input before fetching", async (context) => {
  const cases: Array<[string, string[], string]> = [
    ["address", ["not-an-address", "wmon"], "address must be a 20-byte hex value"],
    ["export name", [ADDRESS, "1bad-name"], "exportName must be a TypeScript identifier"],
    ["argument count", [ADDRESS], "Usage:"],
    ["extra arguments", [ADDRESS, "wmon", "extra"], "Usage:"],
  ];

  for (const [name, args, message] of cases) {
    await context.test(name, async () => {
      let fetched = false;
      const result = await call(args, undefined, async () => {
        fetched = true;
        return response({});
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(message));
      assert.equal(fetched, false);
    });
  }
});

test("reports a missing API key", async () => {
  const result = await call([ADDRESS, "wmon"], {});
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /MONADSCAN_API_KEY is not set/);
});

test("reports network and HTTP failures without emitting TypeScript", async (context) => {
  await context.test("network", async () => {
    const result = await call([ADDRESS, "wmon"], undefined, async () => {
      throw new Error("offline");
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /network failure.*offline/);
  });

  await context.test("HTTP", async () => {
    const result = await call([ADDRESS, "wmon"], undefined, async () =>
      response("unavailable", 503),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /HTTP 503/);
  });
});

test("rejects API failure and malformed result shapes", async (context) => {
  const cases: Array<[string, unknown, string]> = [
    [
      "API failure",
      { status: "0", message: "NOTOK", result: "Contract source code not verified" },
      "Contract source code not verified",
    ],
    ["non-JSON response", "not json", "non-JSON body"],
    ["malformed ABI JSON", { status: "1", message: "OK", result: "{x" }, "malformed ABI JSON"],
    [
      "non-array ABI",
      { status: "1", message: "OK", result: JSON.stringify({ type: "function" }) },
      "is not an ABI array",
    ],
    ["non-string result", { status: "1", message: "OK", result: [] }, "non-string result"],
  ];

  for (const [name, body, message] of cases) {
    await context.test(name, async () => {
      const result = await call([ADDRESS, "wmon"], undefined, async () => response(body));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(message));
    });
  }
});

test("redacts raw and URL-encoded API keys from failures", async () => {
  const result = await call([ADDRESS, "wmon"], { MONADSCAN_API_KEY: SPECIAL_KEY }, async () => {
    throw new Error(`request failed for apikey=${ENCODED_SPECIAL_KEY} (${SPECIAL_KEY})`);
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.includes(SPECIAL_KEY), false);
  assert.equal(result.stderr.includes(SPECIAL_KEY), false);
  assert.equal(result.stderr.includes(ENCODED_SPECIAL_KEY), false);
  assert.match(result.stderr, /\[REDACTED\]/);
});

test("prints help without an API key", async () => {
  const result = await call(["--help"], {});
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Usage: pnpm fetch-abi/);
  assert.match(result.stdout, /MONADSCAN_API_KEY/);
});

function callCli(
  args: string[],
  options: { body?: unknown; error?: string; key?: string; status?: number } = {},
) {
  const body = options.body ?? { status: "1", message: "OK", result: JSON.stringify(ABI) };
  const source = options.error
    ? `globalThis.fetch = async () => { throw new Error(${JSON.stringify(options.error)}); };`
    : `globalThis.fetch = async () => new Response(${JSON.stringify(typeof body === "string" ? body : JSON.stringify(body))}, { status: ${options.status ?? 200} });`;
  const env = { ...process.env, MONADSCAN_API_KEY: options.key ?? KEY };
  if (options.key === "") delete env.MONADSCAN_API_KEY;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      `data:text/javascript,${encodeURIComponent(source)}`,
      fileURLToPath(new URL("./cli.ts", import.meta.url)),
      ...args,
    ],
    { encoding: "utf8", env },
  );
  return result;
}

test("the CLI process uses env, stdout, stderr, and exit status", async (context) => {
  await context.test("success", () => {
    const result = callCli([ADDRESS, "wmon"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /export const wmonAbi =/);
  });

  await context.test("missing key", () => {
    const result = callCli([ADDRESS, "wmon"], { key: "" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /MONADSCAN_API_KEY is not set/);
  });

  await context.test("API failure", () => {
    const result = callCli([ADDRESS, "wmon"], {
      body: { status: "0", message: "NOTOK", result: "Contract source code not verified" },
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Contract source code not verified/);
  });

  await context.test("encoded key redaction", () => {
    const result = callCli([ADDRESS, "wmon"], {
      key: SPECIAL_KEY,
      error: `https://api.etherscan.io/v2/api?apikey=${ENCODED_SPECIAL_KEY}`,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(SPECIAL_KEY), false);
    assert.equal(result.stderr.includes(ENCODED_SPECIAL_KEY), false);
  });
});
