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

  // --- Score interpretation ---
  if (strength > 0.8) {
    // High-strength memory → eligible for automatic LTM promotion.
    // You may trigger a UI update here.
  } else if (strength > 0.5) {
    // Medium-strength memory → remains in STM with standard decay.
    // You may trigger a UI update here.
  } else {
    // Low-strength memory → may be archived after prolonged inactivity.
    // You may trigger a UI update here.
  }

  if (interference > 0.3) {
    // ⚠️  High interference detected — consider conflict resolution.
    // You may trigger a UI warning here.
  }
}

main();
