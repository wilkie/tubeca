import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { CollectionWatchSummary, WatchProgress } from '../api/client';

const BATCH_SIZE = 200;

function chunk(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) out.push(ids.slice(i, i + BATCH_SIZE));
  return out;
}

export interface WatchState {
  /** Progress rows keyed by media id; absent when never played */
  progress: Record<string, WatchProgress>;
  /** Watched/total roll-ups keyed by collection id */
  summaries: Record<string, CollectionWatchSummary>;
  /** Mark or unmark a media item as watched; resolves true on success */
  setWatched: (mediaId: string, watched: boolean) => Promise<boolean>;
  /** Re-fetch everything (e.g. after playback) */
  refresh: () => void;
}

/**
 * Loads the current user's watch state for a set of media and collections and
 * keeps it in sync when the user marks items watched from a card.
 */
export function useWatchState(input: { mediaIds?: string[]; collectionIds?: string[] }): WatchState {
  const mediaKey = (input.mediaIds ?? []).join(',');
  const collectionKey = (input.collectionIds ?? []).join(',');
  const [progress, setProgress] = useState<Record<string, WatchProgress>>({});
  const [summaries, setSummaries] = useState<Record<string, CollectionWatchSummary>>({});
  const [progressVersion, setProgressVersion] = useState(0);
  const [summaryVersion, setSummaryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ids = mediaKey ? mediaKey.split(',') : [];
    if (ids.length === 0) return;
    Promise.all(chunk(ids).map((part) => apiClient.getWatchProgressBatch(part))).then((results) => {
      if (cancelled) return;
      const merged: Record<string, WatchProgress> = {};
      for (const result of results) Object.assign(merged, result?.data?.progress ?? {});
      setProgress(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaKey, progressVersion]);

  useEffect(() => {
    let cancelled = false;
    const ids = collectionKey ? collectionKey.split(',') : [];
    if (ids.length === 0) return;
    Promise.all(chunk(ids).map((part) => apiClient.getCollectionWatchSummaries(part))).then((results) => {
      if (cancelled) return;
      const merged: Record<string, CollectionWatchSummary> = {};
      for (const result of results) Object.assign(merged, result?.data?.summaries ?? {});
      setSummaries(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [collectionKey, summaryVersion]);

  const refresh = useCallback(() => {
    setProgressVersion((v) => v + 1);
    setSummaryVersion((v) => v + 1);
  }, []);

  const setWatched = useCallback(
    async (mediaId: string, watched: boolean) => {
      const result = watched ? await apiClient.markWatched(mediaId) : await apiClient.clearWatchProgress(mediaId);
      if (result?.error) return false;
      setProgress((prev) => {
        const next = { ...prev };
        if (watched && 'data' in result && result.data && 'progress' in result.data && result.data.progress) {
          next[mediaId] = result.data.progress;
        } else {
          delete next[mediaId];
        }
        return next;
      });
      // Collection roll-ups depend on the server's view; re-fetch them.
      if (collectionKey) setSummaryVersion((v) => v + 1);
      return true;
    },
    [collectionKey]
  );

  return { progress, summaries, setWatched, refresh };
}
