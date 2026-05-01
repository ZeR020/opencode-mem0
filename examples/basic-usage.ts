/**
 * Basic Usage Example for opencode-mem0
 *
 * Demonstrates how to add memories, search them, and list results
 * using the LocalMemoryClient API.
 */

import { memoryClient } from "../src/services/client.js";
import { log } from "../src/services/logger.js";

async function main() {
  // Ensure the memory system is warmed up
  await memoryClient.warmup();

  const containerTag = "mem_project_my-awesome-app";

  // --- Add a memory ---
  const addResult = await memoryClient.addMemory(
    "User prefers dark mode in all IDE settings and dislikes light themes.",
    containerTag,
    {
      type: "preference",
      source: "manual",
      tags: ["ui", "preference", "dark-mode"],
      displayName: "My Awesome App",
      projectPath: "/home/user/projects/my-awesome-app",
      projectName: "my-awesome-app",
    }
  );

  if (addResult.success) {
    console.log(`Memory added with ID: ${addResult.id}`);
  } else {
    console.error("Failed to add memory:", addResult.error);
    return;
  }

  // --- Add another memory ---
  await memoryClient.addMemory(
    "The API base URL for this project is https://api.example.com/v2.",
    containerTag,
    {
      type: "configuration",
      source: "manual",
      tags: ["api", "config", "url"],
      projectPath: "/home/user/projects/my-awesome-app",
    }
  );

  // --- Search memories ---
  const searchResult = await memoryClient.searchMemories(
    "dark mode UI preference",
    containerTag,
    "project",
    {
      projectPath: "/home/user/projects/my-awesome-app",
      projectName: "my-awesome-app",
    }
  );

  if (searchResult.success) {
    console.log(`\nSearch returned ${searchResult.total} results:`);
    for (const result of searchResult.results) {
      console.log(`  - ${result.memory} (score: ${result.similarity?.toFixed(3)})`);
    }
  } else {
    console.error("Search failed:", searchResult.error);
  }

  // --- List all memories ---
  const listResult = await memoryClient.listMemories(containerTag, 20, "project");

  if (listResult.success) {
    console.log(`\nListed ${listResult.memories.length} memories:`);
    for (const memory of listResult.memories) {
      console.log(`  [${memory.id}] ${memory.summary}`);
      console.log(
        `    Strength: ${memory.strength?.toFixed(3)} | Store: ${memory.storeType || "stm"}`
      );
    }
  }

  // --- Clean up ---
  memoryClient.close();
  console.log("\nDone!");
}

main().catch((error) => {
  log("Example failed", { error: String(error) });
  process.exit(1);
});
