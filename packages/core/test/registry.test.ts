import { parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { Capability, Protocol, Query } from "../src/decorators.js";
import type { Handle } from "../src/handle.js";
import { defineProtocolPackage } from "../src/manifest.js";
import { plan } from "../src/plan.js";
import { Registry } from "../src/registry.js";
import type { MossRuntime } from "../src/runtime.js";
import { nativeAmount } from "../src/semantics.js";
import { NATIVE } from "../src/types.js";

const VaultAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function totalSupply() view returns (uint256)",
]);

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as const;

@Protocol({
  name: "testvault",
  category: "token",
  description: "test-only vault",
  contracts: { vault: { abi: VaultAbi, addr: VAULT } },
})
class TestVault {
  declare vault: Handle<typeof VaultAbi>;

  @Capability({
    intent: "Wrap {amount} MON into the vault",
    verb: "wrap",
    params: { amount: nativeAmount },
    risk: ["fundOut"],
    tags: ["test"],
  })
  async wrap({ amount }: { amount: bigint }) {
    return plan([this.vault.deposit([], { value: amount })], {
      out: [{ token: NATIVE, amountMax: amount }],
    });
  }

  @Query({
    intent: "Total vault supply",
    params: {},
  })
  async totalSupply() {
    return { total: await this.vault.read.totalSupply() };
  }
}

function mockRuntime(): MossRuntime {
  return {
    chainId: 143,
    rpcUrl: "http://mock",
    client: {
      readContract: async () => 999n,
      // biome-ignore lint/suspicious/noExplicitAny: minimal client stub
    } as any,
  };
}

describe("registry", () => {
  it("registers via decorator metadata, discovers and loads", () => {
    const registry = new Registry(mockRuntime());
    registry.register(TestVault);

    const found = registry.discover({ verb: "wrap" });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ protocol: "testvault", method: "wrap", kind: "capability" });

    const all = registry.discover();
    expect(all).toHaveLength(2); // capability + query

    const [stub] = registry.load([{ protocol: "testvault", method: "wrap" }]);
    expect(stub?.risk).toEqual(["fundOut"]);
    expect(stub?.params.amount).toContain("MON");
  });

  it("builds a finalized Plan through action, with handles injected", async () => {
    const registry = new Registry(mockRuntime());
    registry.register(TestVault);

    const result = await registry.action("testvault", "wrap", ACCOUNT, { amount: "1.5" });
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") throw new Error("expected plan");
    expect(result.intent).toBe("Wrap 1.5 MON into the vault");
    expect(result.account).toBe(ACCOUNT);
    expect(result.txs).toEqual([
      {
        from: ACCOUNT,
        to: VAULT,
        data: "0xd0e30db0", // deposit()
        value: "0x14d1120d7b160000", // 1.5e18
      },
    ]);
    expect(result.expects.out).toEqual([{ token: NATIVE, amountMax: "1500000000000000000" }]);
    expect(result.planHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("runs queries through the injected read handle", async () => {
    const registry = new Registry(mockRuntime());
    registry.register(TestVault);
    const result = await registry.action("testvault", "totalSupply", ACCOUNT, {});
    expect(result).toMatchObject({ kind: "query", data: { total: "999" } });
  });

  it("starts empty and assembles from protocol packages via use()", () => {
    const registry = new Registry(mockRuntime());
    expect(registry.discover()).toHaveLength(0); // nothing auto-registers (ADR 0006)
    registry.use(defineProtocolPackage({ name: "test", protocols: [TestVault] }));
    expect(registry.discover()).toHaveLength(2);
    // biome-ignore lint/suspicious/noExplicitAny: intentional misuse
    expect(() => registry.use({} as any)).toThrow("ProtocolPackage");
  });

  it("rejects undecorated classes and unknown coordinates", () => {
    const registry = new Registry(mockRuntime());
    class Naked {}
    // biome-ignore lint/suspicious/noExplicitAny: intentional misuse
    expect(() => registry.register(Naked as any)).toThrow("not decorated");
    expect(() => registry.load([{ protocol: "nope", method: "x" }])).toThrow("unknown protocol");
  });
});
