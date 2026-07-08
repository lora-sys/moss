#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMossServer } from "./server.js";

// stdout belongs to the MCP protocol; anything human goes to stderr.
const rpcUrl = process.env.MOSS_RPC_URL;
const chainId = process.env.MOSS_CHAIN_ID ? Number(process.env.MOSS_CHAIN_ID) : undefined;

const { server, registry } = createMossServer({
  ...(rpcUrl ? { rpcUrl } : {}),
  ...(chainId !== undefined ? { chainId } : {}),
});

const catalog = registry.discover();
console.error(
  `moss-mcp: ${catalog.length} capabilities/queries across ` +
    `${new Set(catalog.map((c) => c.protocol)).size} protocols on chain ` +
    `${registry.runtime.chainId} (${registry.runtime.rpcUrl})`,
);

await server.connect(new StdioServerTransport());
