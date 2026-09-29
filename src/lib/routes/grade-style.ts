import type { Steepness } from "./elevation";

/**
 * The colours the 3D line is drawn in: blue, yellow, red, black, easy to hard.
 *
 * Four rather than the model's five. Flat and gentle ground are both "easy" to
 * a walker, and a fifth colour on a phone-sized map reads as noise rather than
 * as information.
 */
export type Tier = "easy" | "moderate" | "hard" | "severe";

export const TIER_ORDER: Tier[] = ["easy", "moderate", "hard", "severe"];

export const TIER_OF: Record<Steepness, Tier> = {
  flat: "easy",
  gentle: "easy",
  moderate: "moderate",
  steep: "hard",
  severe: "severe",
};

export const TIER_LINE: Record<Tier, string> = {
  easy: "#2563EB",
  moderate: "#EAB308",
  hard: "#EF4444",
  severe: "#202320",
};

export const TIER_LABEL: Record<Tier, string> = {
  easy: "쉬움",
  moderate: "보통",
  hard: "어려움",
  severe: "매우 어려움",
};
