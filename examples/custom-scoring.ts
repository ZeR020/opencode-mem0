/**
 * Custom Scoring Example for opencode-mem0
 *
 * Demonstrates how to use the 7-factor scoring system directly
 * to evaluate memory quality before insertion or for analytics.
 */

import {
  calculateRecency,
  calculateFrequency,
  calculateImportance,
  calculateUtility,
  calculateNovelty,
  calculateConfidence,
  calculateInterference,
  computeStrength,
  calculateAllScores,
  type ScoreComponents,
} from "../src/services/memory-scoring.js";

function main() {
  const content =
    "Refactored the authentication middleware to use JWT tokens instead of session cookies for better scalability.";
  const existingContents = [
    "User prefers dark mode in all IDE settings.",
    "The API base URL is https://api.example.com/v2.",
    "Authentication is handled via session cookies.", // Potential conflict
  ];
  const conflictingMemories = ["Authentication is handled via session cookies."];

  // --- Calculate individual scores ---
  const createdAt = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
  const lastAccessed = Date.now() - 1 * 24 * 60 * 60 * 1000; // 1 day ago

  const recency = calculateRecency(createdAt);
  const frequency = calculateFrequency(5); // Accessed 5 times
  const importance = calculateImportance(content, "refactor");
  const utility = calculateUtility(lastAccessed, 3, content, {
    recentFiles: ["auth.ts", "middleware.ts"],
    recentQueries: ["jwt authentication refactoring"],
  });
  const novelty = calculateNovelty(content, existingContents);
  const confidence = calculateConfidence("manual", "refactor");
  const interference = calculateInterference(content, conflictingMemories);

  console.log("=== Individual Scores ===");
  console.log(`Recency:      ${recency.toFixed(3)}`);
  console.log(`Frequency:    ${frequency.toFixed(3)}`);
  console.log(`Importance:   ${importance.toFixed(3)}`);
  console.log(`Utility:      ${utility.toFixed(3)}`);
  console.log(`Novelty:      ${novelty.toFixed(3)}`);
  console.log(`Confidence:   ${confidence.toFixed(3)}`);
  console.log(`Interference: ${interference.toFixed(3)}`);

  // --- Compute overall strength ---
  const scores: ScoreComponents = {
    recency,
    frequency,
    importance,
    utility,
    novelty,
    confidence,
    interference,
  };

  const strength = computeStrength(scores);
  console.log(`\n=== Overall Strength: ${strength.toFixed(3)} ===`);

  // --- Calculate all scores in one call ---
  const allScores = calculateAllScores({
    createdAt,
    accessCount: 5,
    lastAccessed,
    content,
    existingContents,
    conflictingMemories,
    source: "manual",
    type: "refactor",
    halfLifeDays: 7,
    utilityHalfLifeDays: 3,
  });

  console.log("\n=== Batch Calculation ===");
  console.log(JSON.stringify(allScores, null, 2));

  // --- Score interpretation ---
  console.log("\n=== Interpretation ===");
  if (strength > 0.8) {
    console.log("High-strength memory → eligible for automatic LTM promotion.");
  } else if (strength > 0.5) {
    console.log("Medium-strength memory → remains in STM with standard decay.");
  } else {
    console.log("Low-strength memory → may be archived after prolonged inactivity.");
  }

  if (interference > 0.3) {
    console.log("⚠️  High interference detected — consider conflict resolution.");
  }
}

main();
