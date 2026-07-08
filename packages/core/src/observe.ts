import type { Abi } from "viem";
import type { TokenSource } from "./token.js";
import type { Address, Hex, Plan } from "./types.js";

/**
 * The OBSERVATION plane of simulation (ADR 0008): protocol-authored,
 * curated narration of what happened in protocol terms — "swapped X for Y
 * across N fills". It complements the AUDIT plane (generic vocabulary +
 * reconciliation), and the red line is one-directional: observations may
 * TIGHTEN the outcome (a declared confirmation that fails to appear warns),
 * but can never satisfy or replace an audit check.
 */

/** One protocol event decoded via the protocol's own origin-verified ABI. */
export interface DecodedEvent {
  /** The contracts-config key the emitting address belongs to ("router"). */
  contract: string;
  address: Address;
  name: string;
  /** Decoded args — bigints preserved for handler math. */
  args: Record<string, unknown>;
}

/**
 * Shared context for one plan × one protocol observation pass. Auto-injected
 * as the trailing argument of dealers and handlers (the DecodeCtx lineage);
 * `shared` is the scratch space a dealer seeds for its handlers.
 */
export interface ObserveCtx {
  plan: Plan;
  account: Address;
  token: TokenSource;
  shared: Record<string, unknown>;
}

/** Preprocessor: filter/enrich/aggregate the matched events before handling. */
export type DealerFn = (
  events: DecodedEvent[],
  ctx: ObserveCtx,
  // biome-ignore lint/suspicious/noConfusingVoidType: dealers may return nothing (mutate ctx.shared instead) — void keeps that ergonomic
) => DecodedEvent[] | undefined | void | Promise<DecodedEvent[] | undefined | void>;

/** A rendered protocol observation attached to a PlanSimResult. */
export interface PlanObservation {
  protocol: string;
  /** The @Event method name — also the id `confirms` refers to. */
  name: string;
  /** The declaration's intent template, rendered from the handler's data. */
  intent: string;
  data: Record<string, unknown>;
}

/** Extract `{placeholder}` names from an intent template literal. */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;

/** Keys of This that hold injected contract Handles. */
type HandleKeys<This> = {
  [K in keyof This]: This[K] extends { abi: Abi; read: unknown } ? K : never;
}[keyof This] &
  string;

type AbiOf<H> = H extends { abi: infer A extends Abi } ? A : never;
type AbiEventNames<TAbi extends Abi> = Extract<TAbi[number], { type: "event" }>["name"] & string;

/** Method names on This whose signature matches DealerFn — the completion set. */
type DealerNames<This> = {
  [K in keyof This]: This[K] extends DealerFn ? K : never;
}[keyof This] &
  string;

export interface EventSpec<This, S extends string> {
  /**
   * Multi-event subscription: contracts-config key → event names, both
   * autocompleted from the class (keys from injected Handles, names from
   * each Handle's ABI — the origin-verified ABI pays out again here).
   */
  events: { [K in HandleKeys<This>]?: readonly AbiEventNames<AbiOf<This[K]>>[] };
  /**
   * Optional preprocessor receiving ALL matched events before the handler:
   * a method name (autocompleted from dealer-shaped methods on the class)
   * or a standalone function.
   */
  dealer?: DealerNames<This> | DealerFn;
  /**
   * Result-intent template. Placeholders are checked against the handler's
   * return keys at render time (loud throw) — compile-time checking is
   * blocked by TS's lack of partial type-argument inference (#26242).
   */
  intent: S;
}

/** The runtime shape of a declaration (the generics only serve authoring DX). */
export interface EventMeta {
  spec: {
    events: Record<string, readonly string[] | undefined>;
    dealer?: string | DealerFn;
    intent: string;
  };
}

export const EVENT_META = Symbol.for("moss.event");

type RequiresThis = {
  readonly __provide_your_protocol_class__: "@Event<MyProtocol>({ … })";
};

/**
 * Declare an observation: which protocol events it consumes, how they are
 * preprocessed, and what the result means. The protocol class type argument
 * is MANDATORY — it is what powers contract-key/event-name/dealer completion:
 *
 *   @Event<Kuru>({
 *     events: { router: ["KuruRouterSwap"], monUsdc: ["Trade"] },
 *     dealer: "countFills",
 *     intent: "Swapped {amountIn} {tokenIn} into {amountOut} {tokenOut}",
 *   })
 *   async swapResult(events: DecodedEvent[], ctx: ObserveCtx) { … }
 *
 * Handlers return the template's data (or null to produce no observation).
 */
export function Event<This = RequiresThis, S extends string = string>(
  spec: [This] extends [RequiresThis]
    ? "ERROR: the protocol class type argument is mandatory — @Event<MyProtocol>({ … })"
    : EventSpec<This, S>,
) {
  // biome-ignore lint/suspicious/noExplicitAny: decorator target is untyped by design
  return (method: any, context: ClassMethodDecoratorContext): void => {
    if (context.kind !== "method" || context.static) {
      throw new Error("@Event decorates instance methods");
    }
    Object.defineProperty(method, EVENT_META, {
      value: { spec: spec as unknown as EventMeta["spec"] } satisfies EventMeta,
      enumerable: false,
    });
  };
}

/** The hook a Registry hands to the simulator (SimulatorOptions.observer). */
export type ObserverHook = (
  plan: Plan,
  logs: readonly { address: Address; topics: Hex[]; data: Hex }[],
) => Promise<PlanObservation[]>;
