/**
 * CHANGEME: <Protocol> — one sentence on what it is and what this adapter
 * covers. Document quirks the next maintainer must know: upgradeable proxies?
 * fee-on-transfer tokens? cooldown periods? cleanup calls?
 *
 * Authoring rules worth re-reading before you start (full guide:
 * docs/protocol-onboarding.md):
 *
 *   - Verbs are USER-PERSPECTIVE fund semantics from the closed set — never
 *     protocol function names. WMON's deposit() is `wrap`; a lending deposit
 *     is `supply`; a CLOB market order is `swap` + tags: ["clob"].
 *   - Params are human-readable; semantic types do the scaling. Contextual
 *     types (tokenAmount("asset")) must come AFTER the param they reference.
 *   - Every capability returns plan(steps, flows) with QUANTIFIED expects —
 *     max out, min in. Approvals via Token.approveStep are auto-declared.
 *   - Verify every address on-chain and note how in a comment.
 */
import {
  type Address,
  address,
  Capability,
  type Handle,
  NATIVE,
  nativeAmount,
  Protocol,
  plan,
  Query,
} from "@mossxyz/core";
import { ExampleVaultAbi } from "./abis/example.js";

// CHANGEME: verified on-chain how? (bytecode present, metadata matches, source?)
export const EXAMPLE_VAULT_ADDRESS: Address = "0x0000000000000000000000000000000000000001";

@Protocol({
  name: "template", // CHANGEME: unique lowercase slug — the discover coordinate
  category: "token", // closed set: dex lending staking rewards token nft
  description: "CHANGEME: one line an agent can understand.",
  contracts: {
    // Key must match the `declare` field below. For protocols that operate on
    // caller-supplied addresses, use `contracts: {}` and `declare runtime` —
    // see the generic erc20 protocol in @mossxyz/erc.
    vault: { abi: ExampleVaultAbi, addr: EXAMPLE_VAULT_ADDRESS },
  },
})
export class ExampleProtocol {
  declare vault: Handle<typeof ExampleVaultAbi>;

  @Capability({
    intent: "Deposit {amount} MON into the example vault",
    verb: "supply",
    params: { amount: nativeAmount },
    risk: ["fundOut"],
    tags: ["example"], // CHANGEME: long-tail semantics (clob, lst, ...)
  })
  async deposit({ amount }: { amount: bigint }) {
    const step = this.vault.deposit([], { value: amount });
    return plan([step], {
      out: [{ token: NATIVE, amountMax: amount }],
      // CHANGEME: declare what must arrive (receipt tokens? nothing for a
      // pure deposit that only creates a position — that's legitimate).
    });
  }

  @Query({
    intent: "Example vault balance of {owner}",
    params: { owner: address },
  })
  async balanceOf({ owner }: { owner: Address }) {
    const balance = await this.vault.read.balanceOf([owner]);
    return { balance: balance.toString() };
  }
}
