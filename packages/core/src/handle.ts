import {
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  decodeFunctionResult,
  encodeFunctionData,
  type PublicClient,
} from "viem";
import type { Address, Hex } from "./types.js";

/**
 * One step of a capability's output: locally-encoded calldata, nothing more.
 * Steps are assembled into a Plan; they are never signed or sent by Moss.
 */
export interface TxStep {
  to: Address;
  data: Hex;
  value: bigint;
  /** Present on steps built by Token.approveStep — plan() auto-declares these. */
  approval?: { token: Address; spender: Address; amount: bigint };
}

interface StepOpts {
  /** Native MON to attach to the call (payable functions). */
  value?: bigint;
}

type WriteName<TAbi extends Abi> = ContractFunctionName<TAbi, "nonpayable" | "payable">;
type ReadName<TAbi extends Abi> = ContractFunctionName<TAbi, "view" | "pure">;

/** Arguments are passed as an array, viem-style: `handle.supply([asset, amount])`. */
type WriteFns<TAbi extends Abi> = {
  [K in WriteName<TAbi>]: ContractFunctionArgs<
    TAbi,
    "nonpayable" | "payable",
    K
  > extends readonly []
    ? (args?: readonly [], opts?: StepOpts) => TxStep
    : (args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", K>, opts?: StepOpts) => TxStep;
};

type ReadFns<TAbi extends Abi> = {
  [K in ReadName<TAbi>]: ContractFunctionArgs<TAbi, "view" | "pure", K> extends readonly []
    ? () => Promise<ContractFunctionReturnType<TAbi, "view" | "pure", K>>
    : (
        args: ContractFunctionArgs<TAbi, "view" | "pure", K>,
      ) => Promise<ContractFunctionReturnType<TAbi, "view" | "pure", K>>;
};

/**
 * eth_call simulation of write functions: "what would this return if
 * executed now". Still read-only — nothing is signed or sent. This is how
 * orderbook quoting works (simulate the market order, read the fill).
 */
type CallFns<TAbi extends Abi> = {
  [K in WriteName<TAbi>]: (
    args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", K> | readonly [],
    opts?: StepOpts & { from?: Address },
  ) => Promise<ContractFunctionReturnType<TAbi, "nonpayable" | "payable", K>>;
};

/**
 * The injected, ABI-typed gateway to one contract. Calling a write function
 * encodes calldata locally and returns a TxStep; `.read` performs read-only
 * RPC. Signing and sending are outside a Handle's power — and outside Moss.
 *
 * Always declare with the ABI type parameter (`Handle<typeof PoolAbi>`) so
 * method names and arguments are inferred; a bare `Handle` degrades to
 * untyped calls (see ADR 0001).
 */
export type Handle<TAbi extends Abi = Abi> = {
  address: Address;
  abi: TAbi;
  read: ReadFns<TAbi>;
  call: CallFns<TAbi>;
} & Omit<WriteFns<TAbi>, "address" | "abi" | "read" | "call">;

export function createHandle<TAbi extends Abi>(
  abi: TAbi,
  contractAddress: Address,
  client: PublicClient,
): Handle<TAbi> {
  const read = new Proxy(
    {},
    {
      get(_, fn: string) {
        return (args: unknown[] = []) =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: fn,
            args,
            // biome-ignore lint/suspicious/noExplicitAny: public surface is typed; impl dispatches dynamically
          } as any);
      },
    },
  );

  const call = new Proxy(
    {},
    {
      get(_, fn: string) {
        return async (args: unknown[] = [], opts: { value?: bigint; from?: Address } = {}) => {
          const data = encodeFunctionData({
            abi,
            functionName: fn,
            args,
            // biome-ignore lint/suspicious/noExplicitAny: public surface is typed; impl dispatches dynamically
          } as any);
          const result = await client.call({
            to: contractAddress,
            data,
            ...(opts.value !== undefined ? { value: opts.value } : {}),
            ...(opts.from !== undefined ? { account: opts.from } : {}),
          });
          return decodeFunctionResult({
            abi,
            functionName: fn,
            data: result.data ?? "0x",
            // biome-ignore lint/suspicious/noExplicitAny: public surface is typed; impl dispatches dynamically
          } as any);
        };
      },
    },
  );

  return new Proxy(
    { address: contractAddress, abi, read, call },
    {
      get(target, prop: string | symbol) {
        if (prop in target || typeof prop === "symbol") {
          return (target as Record<string | symbol, unknown>)[prop];
        }
        return (args: unknown[] = [], opts: StepOpts = {}): TxStep => {
          if (!Array.isArray(args)) {
            throw new TypeError(
              `handle.${prop}(args, opts?): args must be an array — e.g. handle.${prop}([a, b])`,
            );
          }
          const data = encodeFunctionData({
            abi,
            functionName: prop,
            args,
            // biome-ignore lint/suspicious/noExplicitAny: public surface is typed; impl dispatches dynamically
          } as any);
          return { to: contractAddress, data, value: opts.value ?? 0n };
        };
      },
    },
  ) as Handle<TAbi>;
}
