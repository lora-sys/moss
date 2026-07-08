import type { ProtocolCtor } from "./decorators.js";
import type { KnownToken } from "./tokens.js";

/**
 * What a protocol package exports from its index: the protocols it ships and
 * the tokens it introduces. Registries assemble themselves from packages —
 * `new Registry(runtime)` is empty, `registry.use(pkg)` adds one package.
 * Nothing registers itself via import side effects (ADR 0006).
 */
export interface ProtocolPackage {
  kind: "moss-package";
  /** Package display name, used in collision errors: e.g. "system", "kuru". */
  name: string;
  protocols: readonly ProtocolCtor[];
  tokens: readonly KnownToken[];
}

export function defineProtocolPackage(def: {
  name: string;
  protocols?: readonly ProtocolCtor[];
  tokens?: readonly KnownToken[];
}): ProtocolPackage {
  if (!/^[a-z][a-z0-9-]*$/.test(def.name)) {
    throw new Error(`package name "${def.name}" must be a lowercase slug`);
  }
  return {
    kind: "moss-package",
    name: def.name,
    protocols: def.protocols ?? [],
    tokens: def.tokens ?? [],
  };
}
