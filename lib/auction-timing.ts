export const ANTI_SNIPE_WINDOW_MS = 60_000;

/** Extend an auction by one minute when a bid arrives inside its final minute. */
export function extendAuctionEndIfNeeded(endsAt: number, now: number) {
  return endsAt - now < ANTI_SNIPE_WINDOW_MS ? endsAt + ANTI_SNIPE_WINDOW_MS : endsAt;
}
