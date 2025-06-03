//#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client, estypes, ClientOptions } from "@elastic/elasticsearch";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import pkg from "ioredis";
const Redis = pkg.default || pkg;
const redis = new Redis();

// [DEBUG] Script startup
console.error("[DEBUG] MCP Server script started");

// Configuration schema with auth options
const ConfigSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "Elasticsearch URL cannot be empty")
      .url("Invalid Elasticsearch URL format")
      .describe("Elasticsearch server URL"),

    apiKey: z
      .string()
      .optional()
      .describe("API key for Elasticsearch authentication"),

    username: z
      .string()
      .optional()
      .describe("Username for Elasticsearch authentication"),

    password: z
      .string()
      .optional()
      .describe("Password for Elasticsearch authentication"),

    caCert: z
      .string()
      .optional()
      .describe("Path to custom CA certificate for Elasticsearch"),
  })
  .refine(
    (data) => {
      // If username is provided, password must be provided
      if (data.username) {
        return !!data.password;
      }
      // If password is provided, username must be provided
      if (data.password) {
        return !!data.username;
      }
      // If apiKey is provided, it's valid
      if (data.apiKey) {
        return true;
      }
      // No auth is also valid (for local development)
      return true;
    },
    {
      message:
        "Either ES_API_KEY or both ES_USERNAME and ES_PASSWORD must be provided, or no auth for local development",
      path: ["username", "password"],
    }
  );

type ElasticsearchConfig = z.infer<typeof ConfigSchema>;

export async function createElasticsearchMcpServer(
  config: ElasticsearchConfig
) {
  // [DEBUG] Entered createElasticsearchMcpServer
  console.error("[DEBUG] createElasticsearchMcpServer() called");
  const validatedConfig = ConfigSchema.parse(config);
  const { url, apiKey, username, password, caCert } = validatedConfig;

  const clientOptions: ClientOptions = {
    node: url,
  };

  // Set up authentication
  if (apiKey) {
    clientOptions.auth = { apiKey };
  } else if (username && password) {
    clientOptions.auth = { username, password };
  }

  // Set up SSL/TLS certificate if provided
  if (caCert) {
    try {
      const ca = fs.readFileSync(caCert);
      clientOptions.tls = { ca };
      console.error("[DEBUG] Loaded CA certificate for TLS");
    } catch (error) {
      console.error(
        `Failed to read certificate file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const esClient = new Client(clientOptions);

  const server = new McpServer({
    name: "elasticsearch-mcp-server",
    version: "0.1.1",
  });

  // [DEBUG] Registering tools
  console.error("[DEBUG] Registering tools: list_indices, get_mappings, search, get_shards");

  // Tool 1: List indices
  server.tool(
    "list_indices",
    "List all available Elasticsearch indices",
    {
      indexPattern: z
        .string()
        .trim()
        .min(1, "Index pattern is required")
        .describe("Index pattern of Elasticsearch indices to list"),
    },
    async ({ indexPattern }) => {
      console.error("[DEBUG] list_indices tool called", indexPattern);
      try {
        const response = await esClient.cat.indices({
          index: indexPattern,
          format: "json"
        });

        const indicesInfo = response.map((index) => ({
          index: index.index,
          health: index.health,
          status: index.status,
          docsCount: index.docsCount,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${indicesInfo.length} indices`,
            },
            {
              type: "text" as const,
              text: JSON.stringify(indicesInfo, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(
          `Failed to list indices: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool 2: Get mappings for an index
  server.tool(
    "get_mappings",
    "Get field mappings for a specific Elasticsearch index",
    {
      index: z
        .string()
        .trim()
        .min(1, "Index name is required")
        .describe("Name of the Elasticsearch index to get mappings for"),
    },
    async ({ index }) => {
      console.error("[DEBUG] get_mappings tool called", index);
      try {
        const mappingResponse = await esClient.indices.getMapping({
          index,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Mappings for index: ${index}`,
            },
            {
              type: "text" as const,
              text: `Mappings for index ${index}: ${JSON.stringify(
                mappingResponse[index]?.mappings || {},
                null,
                2
              )}`,
            },
          ],
        };
      } catch (error) {
        console.error(
          `Failed to get mappings: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool 3: Search an index with simplified parameters
  server.tool(
    "search",
    "Perform an Elasticsearch search with the provided query DSL. Highlights are always enabled.",
    {
      index: z
        .string()
        .trim()
        .min(1, "Index name is required")
        .describe("Name of the Elasticsearch index to search"),

      queryBody: z
        .record(z.any())
        .refine(
          (val) => {
            try {
              JSON.parse(JSON.stringify(val));
              return true;
            } catch (e) {
              return false;
            }
          },
          {
            message: "queryBody must be a valid Elasticsearch query DSL object",
          }
        )
        .describe(
          "Complete Elasticsearch query DSL object that can include query, size, from, sort, etc."
        ),

      userId: z.string().min(1).describe("User ID for permission filtering"),
    },
    async ({ index, queryBody, userId }) => {
      console.error("[DEBUG] search tool called", index, userId, queryBody);
      try {

        const redisKey = `GLOBAL_SEARCH_INDEX_ID_MAPPING:${userId}`;
        const jsonString = await redis.get(redisKey);

        console.error("[DEBUG] Redis key fetched:", redisKey, "->", jsonString);

        const allowedIdsObj = jsonString
          ? JSON.parse(jsonString)
          : {
            header_section_doc_ids: [],
            line_item_section_doc_ids: [],
            header_clause_doc_ids: [],
            line_item_clause_doc_ids: [],
            attachment_doc_ids: [],
            meta_doc_ids: [],
          };

        const allowedIds = [
          ...allowedIdsObj.header_section_doc_ids,
          ...allowedIdsObj.line_item_section_doc_ids,
          ...allowedIdsObj.header_clause_doc_ids,
          ...allowedIdsObj.line_item_clause_doc_ids,
          ...allowedIdsObj.attachment_doc_ids,
          ...allowedIdsObj.meta_doc_ids,
        ];

        console.error("[DEBUG] Allowed IDs to filter on:", allowedIds);

        // if (!queryBody.query) queryBody.query = { bool: { must: [] } };
        // else if (!queryBody.query.bool) queryBody.query.bool = { must: [] };
        // else if (!queryBody.query.bool.must) queryBody.query.bool.must = [];

        // queryBody.query.bool.must.push({
        //   terms: {
        //     "AGREEMENT_ID.keyword": allowedIds.length > 0 ? allowedIds : ["__none__"],
        //   },
        // });

        // Permission terms filter
      const permissionFilter = {
        terms: {
          "AGREEMENT_ID.keyword": allowedIds.length > 0 ? allowedIds : ["__none__"],
        },
      };

      // If no query, make a bool with only your filter
      if (!queryBody.query) {
        queryBody.query = {
          bool: {
            filter: [permissionFilter],
          }
        };
      }
      // If the query is already a bool, inject your filter
      else if (queryBody.query.bool) {
        if (!queryBody.query.bool.filter) {
          queryBody.query.bool.filter = [];
        }
        queryBody.query.bool.filter.push(permissionFilter);
      }
      // If the query is any other type (e.g. term, match), wrap in bool
      else {
        // Store the original query
        const originalQuery = queryBody.query;
        queryBody.query = {
          bool: {
            must: [originalQuery],
            filter: [permissionFilter],
          }
        };
      }

        console.error("[DEBUG] Final queryBody to send to ES:", JSON.stringify(queryBody, null, 2));

        // Get mappings to identify text fields for highlighting
        const mappingResponse = await esClient.indices.getMapping({
          index,
        });

        const indexMappings = mappingResponse[index]?.mappings || {};

        const searchRequest: estypes.SearchRequest = {
          index,
          ...queryBody,
        };

        // Always do highlighting
        if (indexMappings.properties) {
          const textFields: Record<string, estypes.SearchHighlightField> = {};

          for (const [fieldName, fieldData] of Object.entries(
            indexMappings.properties
          )) {
            if (fieldData.type === "text" || "dense_vector" in fieldData) {
              textFields[fieldName] = {};
            }
          }

          searchRequest.highlight = {
            fields: textFields,
            pre_tags: ["<em>"],
            post_tags: ["</em>"],
          };
        }

        // DEBUG: print the final searchRequest object
        console.error("[DEBUG] ES SearchRequest:", JSON.stringify(searchRequest, null, 2));

        const result = await esClient.search(searchRequest);

        // DEBUG: print raw ES response
        console.error("[DEBUG] ES Search Response:", JSON.stringify(result, null, 2));

        
        // Extract the 'from' parameter from queryBody, defaulting to 0 if not provided
        const from = queryBody.from || 0;

        // const contentFragments = result.hits.hits.map((hit) => {
        //   const highlightedFields = hit.highlight || {};
        //   const sourceData = hit._source || {};

        //   let content = "";

        //   for (const [field, highlights] of Object.entries(highlightedFields)) {
        //     if (highlights && highlights.length > 0) {
        //       content += `${field} (highlighted): ${highlights.join(
        //         " ... "
        //       )}\n`;
        //     }
        //   }

        //   for (const [field, value] of Object.entries(sourceData)) {
        //     if (!(field in highlightedFields)) {
        //       content += `${field}: ${JSON.stringify(value)}\n`;
        //     }
        //   }

        //   return {
        //     type: "text" as const,
        //     text: content.trim(),
        //   };
        // });

        // const metadataFragment = {
        //   type: "text" as const,
        //   text: `Total results: ${
        //     typeof result.hits.total === "number"
        //       ? result.hits.total
        //       : result.hits.total?.value || 0
        //     }, showing ${result.hits.hits.length} from position ${from}`,
        // };

        // return {
        //   content: [metadataFragment, ...contentFragments],
        // };

        // ----- AGGREGATION UNIVERSAL HANDLER -----
        function formatAggs(
          aggsObj: Record<string, unknown>,
          prefix = ""
        ): string[] {
          const lines: string[] = [];
          for (const [aggName, aggData] of Object.entries(aggsObj)) {
            if (aggData && typeof aggData === "object" && aggData !== null) {
              // Buckets: must cast and check if 'buckets' is an array
              const maybeBuckets = (aggData as Record<string, unknown>)["buckets"];
              if (Array.isArray(maybeBuckets)) {
                lines.push(`${prefix}Aggregation "${aggName}" (buckets):`);
                if (maybeBuckets.length === 0) {
                  lines.push(`${prefix}  (no buckets)`);
                }
                for (const bucket of maybeBuckets) {
                  if (bucket && typeof bucket === "object" && bucket !== null) {
                    const key = (bucket as Record<string, unknown>)["key"];
                    const docCount = (bucket as Record<string, unknown>)["doc_count"];
                    lines.push(
                      `${prefix}  ${String(key)}: ${String(docCount)}`
                    );
                    // Recursively print nested aggs in buckets
                    for (const [k, v] of Object.entries(bucket)) {
                      if (
                        v &&
                        typeof v === "object" &&
                        v !== null &&
                        (Array.isArray((v as Record<string, unknown>)["buckets"]) ||
                          (v as Record<string, unknown>)["value"] !== undefined)
                      ) {
                        lines.push(
                          ...formatAggs({ [k]: v }, prefix + "    ")
                        );
                      }
                    }
                  }
                }
              } else if (
                // Single metric: e.g., { value: 123 }
                Object.prototype.hasOwnProperty.call(aggData, "value")
              ) {
                lines.push(
                  `${prefix}Aggregation "${aggName}": ${
                    (aggData as Record<string, unknown>)["value"]
                  }`
                );
              } else if (
                // Multi-metric: e.g., { count, min, max, avg, sum }
                Object.keys(aggData).some((k) =>
                  ["values", "avg", "sum", "min", "max", "count"].includes(k)
                )
              ) {
                lines.push(
                  `${prefix}Aggregation "${aggName}": ${JSON.stringify(
                    aggData
                  )}`
                );
              } else {
                // Recursively process other nested aggs (if any)
                for (const [k, v] of Object.entries(aggData)) {
                  if (
                    v &&
                    typeof v === "object" &&
                    v !== null &&
                    (Array.isArray((v as Record<string, unknown>)["buckets"]) ||
                      (v as Record<string, unknown>)["value"] !== undefined)
                  ) {
                    lines.push(...formatAggs({ [k]: v }, prefix + "  "));
                  }
                }
              }
            }
          }
          return lines;
        }
        

        let aggregationFragments: { type: "text"; text: string }[] = [];
        if (result.aggregations) {
          const aggLines = formatAggs(result.aggregations as Record<string, unknown>);
          if (aggLines.length > 0) {
            aggregationFragments.push({
              type: "text" as const,
              text: aggLines.join("\n"),
            });
          }
        }
        
        const contentFragments = result.hits.hits.map((hit) => {
          const highlightedFields = hit.highlight || {};
          const sourceData = hit._source || {};
        
          let content = "";
        
          for (const [field, highlights] of Object.entries(highlightedFields)) {
            if (highlights && highlights.length > 0) {
              content += `${field} (highlighted): ${highlights.join(
                " ... "
              )}\n`;
            }
          }
        
          for (const [field, value] of Object.entries(sourceData)) {
            if (!(field in highlightedFields)) {
              content += `${field}: ${JSON.stringify(value)}\n`;
            }
          }
        
          return {
            type: "text" as const,
            text: content.trim(),
          };
        });
        
        const metadataFragment = {
          type: "text" as const,
          text: `Total results: ${
            typeof result.hits.total === "number"
              ? result.hits.total
              : result.hits.total?.value || 0
            }, showing ${result.hits.hits.length} from position ${from}`,
        };
        
        return {
          content: [...aggregationFragments, metadataFragment, ...contentFragments],
        };
        

      } catch (error) {
        console.error(
          `Search failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool 4: Get shard information
  server.tool(
    "get_shards",
    "Get shard information for all or specific indices",
    {
      index: z
        .string()
        .optional()
        .describe("Optional index name to get shard information for"),
    },
    async ({ index }) => {
      console.error("[DEBUG] get_shards tool called", index);
      try {
        const response = await esClient.cat.shards({
          index,
          format: "json",
        });

        const shardsInfo = response.map((shard) => ({
          index: shard.index,
          shard: shard.shard,
          prirep: shard.prirep,
          state: shard.state,
          docs: shard.docs,
          store: shard.store,
          ip: shard.ip,
          node: shard.node,
        }));

        const metadataFragment = {
          type: "text" as const,
          text: `Found ${shardsInfo.length} shards${
            index ? ` for index ${index}` : ""
          }`,
        };

        return {
          content: [
            metadataFragment,
            {
              type: "text" as const,
              text: JSON.stringify(shardsInfo, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(
          `Failed to get shard information: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // [DEBUG] Returning MCP server instance
  console.error("[DEBUG] Returning server from createElasticsearchMcpServer()");
  return server;
}

const config: ElasticsearchConfig = {
  url: process.env.ES_URL || "",
  apiKey: process.env.ES_API_KEY || "",
  username: process.env.ES_USERNAME || "",
  password: process.env.ES_PASSWORD || "",
  caCert: process.env.ES_CA_CERT || "",
};

async function main() {
  console.error("[DEBUG] main() called");
  const transport = new StdioServerTransport();
  const server = await createElasticsearchMcpServer(config);

  console.error("[DEBUG] Connecting server...");
  await server.connect(transport);

  console.error("[DEBUG] Server connected and waiting for input...");
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(
    "Server error:",
    error instanceof Error ? error.message : String(error)
  );
  console.error("[DEBUG] Exiting due to error");
  process.exit(1);
});