import type { Abi } from "viem";
import { createHandle } from "./handle.js";
import type { MossRuntime } from "./runtime.js";
import type { ParamsSpec } from "./semantics.js";
import type { Address, Category, RiskLabel, Verb } from "./types.js";

export interface ContractConfig {
  abi: Abi;
  /** Deployment address. Moss v1 is single-chain (Monad mainnet) by design. */
  addr: Address;
}

export interface ProtocolConfig {
  /** Unique lowercase slug used as the discover coordinate, e.g. "wmon". */
  name: string;
  category: Category;
  description: string;
  /**
   * May be empty for protocols that operate on caller-supplied addresses
   * (e.g. the generic erc20 protocol): declare `runtime` and build handles
   * dynamically with createHandle.
   */
  contracts: Record<string, ContractConfig>;
}

export interface CapabilitySpec {
  /** Template shown to agents, with {param} placeholders: "Wrap {amount} MON". */
  intent: string;
  verb: Verb;
  params: ParamsSpec;
  risk: RiskLabel[];
  tags?: string[];
  /**
   * Names of this protocol's @Event observations expected to appear when the
   * plan simulates (the on-chain receipt). Missing confirmation → warning.
   * Observation-plane strictness only tightens — never replaces audit
   * (ADR 0008). Hash-covered so it can't be stripped in transit.
   */
  confirms?: string[];
}

export interface QuerySpec {
  intent: string;
  params: ParamsSpec;
  tags?: string[];
}

export type MethodMeta =
  | { kind: "capability"; spec: CapabilitySpec }
  | { kind: "query"; spec: QuerySpec };

/**
 * Metadata is attached as symbol-keyed marker properties on the class and its
 * method functions, NOT via decorator `context.metadata` — Symbol.metadata
 * lowering is still uneven across transpilers (esbuild, oxc), while a marker
 * property compiles identically everywhere. See ADR 0001.
 */
export const PROTOCOL_META = Symbol.for("moss.protocol");
export const METHOD_META = Symbol.for("moss.method");

/** Constructor shape the registry instantiates adapters with. */
export type ProtocolCtor = new (runtime: MossRuntime) => object;

/**
 * Class decorator: subclasses the adapter so contract Handles are injected at
 * construction — `declare pool: Handle<typeof PoolAbi>` is type-only; the
 * value appears here. There is no compiler step (ADR 0001).
 *
 * Note the config key and the `declare` field name must match; a typo'd
 * declare surfaces as "this.X is undefined" at first build, since erased
 * declarations cannot be enumerated at runtime.
 */
export function Protocol(config: ProtocolConfig) {
  if (!/^[a-z][a-z0-9-]*$/.test(config.name)) {
    throw new Error(`protocol name "${config.name}" must be a lowercase slug`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: mixin constructor pattern
  return <T extends new (...args: any[]) => object>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    if (context.kind !== "class") throw new Error("@Protocol decorates classes");
    // biome-ignore lint/suspicious/noExplicitAny: mixin constructor pattern
    const injected = class extends (target as new (...args: any[]) => object) {
      // biome-ignore lint/suspicious/noExplicitAny: mixin constructor pattern
      constructor(...args: any[]) {
        super(...args);
        const runtime = args[0] as MossRuntime;
        if (!runtime || typeof runtime.chainId !== "number") {
          throw new Error(
            `protocol "${config.name}" must be constructed with a MossRuntime (use the registry)`,
          );
        }
        for (const [key, contract] of Object.entries(config.contracts)) {
          Object.defineProperty(this, key, {
            value: createHandle(contract.abi, contract.addr, runtime.client),
            writable: false,
            enumerable: false,
          });
        }
        // Always injected alongside the handles: dynamic-address protocols
        // (`declare runtime: MossRuntime`) build their own handles from it.
        Object.defineProperty(this, "runtime", {
          value: runtime,
          writable: false,
          enumerable: false,
        });
      }
    };
    Object.defineProperty(injected, "name", { value: target.name });
    Object.defineProperty(injected, PROTOCOL_META, { value: config, enumerable: false });
    return injected as unknown as T;
  };
}

function recordMethod(kind: MethodMeta["kind"], spec: CapabilitySpec | QuerySpec) {
  // biome-ignore lint/suspicious/noExplicitAny: decorator target is untyped by design
  return (method: any, context: ClassMethodDecoratorContext): void => {
    if (context.kind !== "method" || context.static) {
      throw new Error(
        `@${kind === "capability" ? "Capability" : "Query"} decorates instance methods`,
      );
    }
    // kind/spec arrive correlated from Capability()/Query(); TS can't see that.
    Object.defineProperty(method, METHOD_META, {
      value: { kind, spec } as MethodMeta,
      enumerable: false,
    });
  };
}

/**
 * A write-intent method: decoded params in, PlanDraft out. Never signs,
 * never sends — the draft becomes a Plan of unsigned transactions.
 */
export function Capability(spec: CapabilitySpec) {
  return recordMethod("capability", spec);
}

/** A read-only method: decoded params in, JSON-safe data out. */
export function Query(spec: QuerySpec) {
  return recordMethod("query", spec);
}
