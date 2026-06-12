/**
 * One motion vocabulary for the pairing mat: a shared crossfade pair so a
 * card leaving a pool and landing in a slot (or a table) reads as the same
 * card flying across the board, plus the standard duration every flip/fade
 * uses. Durations collapse to 0 under prefers-reduced-motion.
 */
import { crossfade } from "svelte/transition";
import { cubicOut } from "svelte/easing";

const reduced =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Standard card-motion duration (ms). */
export const CARD_MS = reduced ? 0 : 220;

export const [sendCard, receiveCard] = crossfade({
  duration: CARD_MS,
  easing: cubicOut,
  // No fallback fade-through — a card with no counterpart just appears, which
  // only happens on initial deal where a pop-in reads fine.
  fallback: (node) => ({
    duration: CARD_MS,
    css: (t) => `opacity:${t};transform:scale(${0.92 + 0.08 * t})`,
  }),
});
