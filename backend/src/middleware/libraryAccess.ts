import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { LibraryService } from '../services/libraryService';

const libraryService = new LibraryService();

/**
 * Result of resolving which library a requested entity belongs to.
 *
 * - `missing`: no such entity; the route handler is left to produce its own 404.
 * - `unscoped`: the entity is not owned by any library (e.g. a person photo).
 * - `orphan`: the entity should belong to a library but no longer does
 *   (media whose collection was deleted); hidden from non-admins.
 * - `library`: owned by `libraryId`; access is checked against the user's groups.
 */
export type LibraryResolution =
  | { kind: 'missing' }
  | { kind: 'unscoped' }
  | { kind: 'orphan' }
  | { kind: 'library'; libraryId: string };

export type LibraryResolver = (req: Request) => Promise<LibraryResolution>;

/**
 * Library ids the caller may see, or `undefined` for admins (no restriction).
 * For list endpoints that embed content from many libraries (person
 * filmographies, user collections), where a per-entity middleware cannot apply.
 */
export async function resolveAccessibleLibraryIds(
  user: { userId: string; role: string } | undefined
): Promise<string[] | undefined> {
  if (!user) return [];
  if (user.role === 'Admin') return undefined;
  return (await libraryService.getAccessibleLibraries(user.userId, false)).map((l) => l.id);
}

const missing: LibraryResolution = { kind: 'missing' };
const unscoped: LibraryResolution = { kind: 'unscoped' };
const orphan: LibraryResolution = { kind: 'orphan' };
const inLibrary = (libraryId: string | null | undefined): LibraryResolution =>
  libraryId ? { kind: 'library', libraryId } : orphan;

export async function resolveCollectionLibrary(collectionId: string): Promise<LibraryResolution> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { libraryId: true },
  });
  return collection ? inLibrary(collection.libraryId) : missing;
}

export async function resolveMediaLibrary(mediaId: string): Promise<LibraryResolution> {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { collection: { select: { libraryId: true } } },
  });
  return media ? inLibrary(media.collection?.libraryId) : missing;
}

export async function resolveImageLibrary(imageId: string): Promise<LibraryResolution> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: {
      collection: { select: { libraryId: true } },
      media: { select: { collection: { select: { libraryId: true } } } },
    },
  });
  if (!image) return missing;
  if (image.collection) return inLibrary(image.collection.libraryId);
  if (image.media) return inLibrary(image.media.collection?.libraryId);
  // Person, credit and other artwork is not tied to a library.
  return unscoped;
}

export async function resolveLibrary(libraryId: string | undefined): Promise<LibraryResolution> {
  if (!libraryId) return missing;
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { id: true } });
  return library ? { kind: 'library', libraryId } : missing;
}

/** Resolver factories keyed on a route parameter. */
export const collectionParam = (name = 'id'): LibraryResolver => (req) =>
  resolveCollectionLibrary(req.params[name]);
export const mediaParam = (name = 'id'): LibraryResolver => (req) =>
  resolveMediaLibrary(req.params[name]);
export const imageParam = (name = 'id'): LibraryResolver => (req) =>
  resolveImageLibrary(req.params[name]);
export const libraryParam = (name = 'libraryId'): LibraryResolver => (req) =>
  resolveLibrary(req.params[name]);

/**
 * Resolver for write endpoints that name their target in the body:
 * whichever of `collectionId` / `mediaId` / `libraryId` is present.
 */
export const entityInBody: LibraryResolver = async (req) => {
  const { collectionId, mediaId, libraryId } = req.body ?? {};
  if (collectionId) return resolveCollectionLibrary(collectionId);
  if (mediaId) return resolveMediaLibrary(mediaId);
  if (libraryId) return resolveLibrary(libraryId);
  return unscoped;
};

/**
 * The entity named in the query string, for routes whose body is not JSON
 * (an image upload sends raw bytes, so the ids travel in the query).
 */
export const entityInQuery: LibraryResolver = async (req) => {
  const { collectionId, mediaId, libraryId } = req.query as Record<string, string | undefined>;
  if (collectionId) return resolveCollectionLibrary(collectionId);
  if (mediaId) return resolveMediaLibrary(mediaId);
  if (libraryId) return resolveLibrary(libraryId);
  return unscoped;
};

/**
 * Enforce group-based library access for the entity a route addresses.
 *
 * Must run after `authenticate` (or a query-token variant). Admins always pass.
 * Inaccessible and orphaned entities are reported as 404 rather than 403 so the
 * response does not reveal that the entity exists, matching `GET /api/libraries/:id`.
 */
export function requireLibraryAccess(resolve: LibraryResolver) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role === 'Admin') {
      return next();
    }

    try {
      const resolution = await resolve(req);
      switch (resolution.kind) {
        case 'missing':
        case 'unscoped':
          return next();
        case 'orphan':
          return res.status(404).json({ error: 'Not found' });
        case 'library': {
          const allowed = await libraryService.canUserAccessLibrary(
            req.user.userId,
            false,
            resolution.libraryId
          );
          return allowed ? next() : res.status(404).json({ error: 'Not found' });
        }
      }
    } catch {
      return res.status(500).json({ error: 'Failed to check library access' });
    }
  };
}
