export type ShareResult = "shared" | "copied" | "cancelled" | "unavailable";

type NavigatorLike = {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
};

/** Prefer the native share sheet and fall back to copying the canonical URL. */
export async function sharePage(
  input: { title: string; url: string },
  navigatorLike: NavigatorLike = globalThis.navigator,
): Promise<ShareResult> {
  if (typeof navigatorLike.share === "function") {
    try {
      await navigatorLike.share(input);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }

  if (typeof navigatorLike.clipboard?.writeText !== "function") return "unavailable";
  try {
    await navigatorLike.clipboard.writeText(input.url);
    return "copied";
  } catch {
    return "unavailable";
  }
}
