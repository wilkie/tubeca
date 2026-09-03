import { useCallback, useEffect, useState } from 'react';
import { apiClient, type UserCollection } from '../api/client';

export interface AddToRecentCollection {
  /** The user's most recently updated collection, once loaded. */
  recentCollection: UserCollection | null;
  /** True while an add is in flight, for disabling the menu item. */
  isAdding: boolean;
  /** Add the given item to that collection. Resolves true when it worked. */
  addToRecent: () => Promise<boolean>;
}

export interface AddToRecentTarget {
  collectionId?: string;
  mediaId?: string;
}

/**
 * The "add to the collection I used last" shortcut that appears in every add
 * menu.
 *
 * The list is only fetched while a menu is open, so browsing a library does
 * not pull the user's collections for every card on screen. Pass `enabled`
 * as the menu's open state.
 */
export function useAddToRecentCollection(
  target: AddToRecentTarget,
  enabled: boolean
): AddToRecentCollection {
  const [recentCollection, setRecentCollection] = useState<UserCollection | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { collectionId, mediaId } = target;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    apiClient.getUserCollections().then((result) => {
      if (cancelled) return;
      const first = result.data?.userCollections[0];
      if (first) setRecentCollection(first);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const addToRecent = useCallback(async () => {
    if (!recentCollection) return false;
    if (!collectionId && !mediaId) return false;

    setIsAdding(true);
    try {
      await apiClient.addUserCollectionItem(recentCollection.id, { collectionId, mediaId });
      return true;
    } catch (error) {
      console.error('Failed to add to collection:', error);
      return false;
    } finally {
      setIsAdding(false);
    }
  }, [recentCollection, collectionId, mediaId]);

  return { recentCollection, isAdding, addToRecent };
}
