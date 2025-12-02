/**
 * Formats a duration in seconds to a human-readable string.
 *
 * @param seconds - The duration in seconds
 * @returns Formatted string like "1h 30m 45s", "30m 45s", or "45s"
 *
 * @example
 * formatDuration(3661) // "1h 1m 1s"
 * formatDuration(1830) // "30m 30s"
 * formatDuration(45)   // "45s"
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}
