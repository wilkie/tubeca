import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { PersonService } from '../services/personService';
import { scraperManager } from '../plugins/scraperLoader';
import { ImageService } from '../services/imageService';

const router = Router();
const personService = new PersonService();
const imageService = new ImageService();

// All routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/persons/{id}:
 *   get:
 *     tags:
 *       - Persons
 *     summary: Get a person
 *     description: Get a person by ID with filmography. Auto-fetches metadata if not available.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Person found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 person:
 *                   $ref: '#/components/schemas/Person'
 *       404:
 *         description: Person not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
  try {
    let person = await personService.getPersonById(req.params.id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Auto-fetch metadata if person has no biography but has external IDs
    if (!person.biography && (person.tmdbId || person.tvdbId)) {
      let metadata = null;
      let scraperId: string | null = null;

      // Try TMDB first
      if (person.tmdbId) {
        const tmdbScraper = scraperManager.get('tmdb');
        if (tmdbScraper?.getPersonMetadata && tmdbScraper.isConfigured()) {
          try {
            metadata = await tmdbScraper.getPersonMetadata(person.tmdbId.toString());
            if (metadata) {
              scraperId = 'tmdb';
            }
          } catch (error) {
            console.warn('Failed to fetch TMDB person metadata:', error);
          }
        }
      }

      // Try TVDB if no TMDB result
      if (!metadata && person.tvdbId) {
        const tvdbScraper = scraperManager.get('tvdb');
        if (tvdbScraper?.getPersonMetadata && tvdbScraper.isConfigured()) {
          try {
            metadata = await tvdbScraper.getPersonMetadata(person.tvdbId.toString());
            if (metadata) {
              scraperId = 'tvdb';
            }
          } catch (error) {
            console.warn('Failed to fetch TVDB person metadata:', error);
          }
        }
      }

      // Update person with metadata if found
      if (metadata) {
        await personService.updatePersonMetadata(person.id, metadata);

        // Download photo if available and person doesn't have one
        if (metadata.photoUrl && scraperId) {
          const hasPhoto = person.images?.some((img) => img.imageType === 'Photo');
          if (!hasPhoto) {
            try {
              await imageService.downloadAndSaveImage(metadata.photoUrl, {
                imageType: 'Photo',
                personId: person.id,
                isPrimary: true,
                scraperId,
              });
            } catch (error) {
              console.warn('Failed to download person photo:', error);
            }
          }
        }

        // Refresh person data after update
        person = await personService.getPersonById(req.params.id);
        if (!person) {
          return res.status(404).json({ error: 'Person not found' });
        }
      }
    }

    res.json({ person });
  } catch {
    res.status(500).json({ error: 'Failed to fetch person' });
  }
});

/**
 * @openapi
 * /api/persons/search:
 *   get:
 *     tags:
 *       - Persons
 *     summary: Search persons
 *     description: Search for persons by name
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 persons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Person'
 *       400:
 *         description: Query parameter is required
 */
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const persons = await personService.searchByName(q);
    res.json({ persons });
  } catch {
    res.status(500).json({ error: 'Failed to search persons' });
  }
});

/**
 * @openapi
 * /api/persons/{id}/refresh:
 *   post:
 *     tags:
 *       - Persons
 *     summary: Refresh person metadata
 *     description: Refresh person metadata from scrapers using external IDs (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Person metadata refreshed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 person:
 *                   $ref: '#/components/schemas/Person'
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Person not found or no metadata found from scrapers
 */
router.post('/:id/refresh', requireRole('Editor'), async (req, res) => {
  try {
    const person = await personService.getPersonById(req.params.id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Try to get metadata from scrapers using external IDs
    let metadata = null;
    let scraperId: string | null = null;

    // Try TMDB first
    if (person.tmdbId) {
      const tmdbScraper = scraperManager.get('tmdb');
      if (tmdbScraper?.getPersonMetadata && tmdbScraper.isConfigured()) {
        metadata = await tmdbScraper.getPersonMetadata(person.tmdbId.toString());
        if (metadata) {
          scraperId = 'tmdb';
        }
      }
    }

    // Try TVDB if no TMDB result
    if (!metadata && person.tvdbId) {
      const tvdbScraper = scraperManager.get('tvdb');
      if (tvdbScraper?.getPersonMetadata && tvdbScraper.isConfigured()) {
        metadata = await tvdbScraper.getPersonMetadata(person.tvdbId.toString());
        if (metadata) {
          scraperId = 'tvdb';
        }
      }
    }

    if (!metadata) {
      return res.status(404).json({ error: 'No metadata found from scrapers' });
    }

    // Update person metadata
    const updatedPerson = await personService.updatePersonMetadata(person.id, metadata);

    // Download photo if available
    if (metadata.photoUrl && scraperId) {
      try {
        await imageService.downloadAndSaveImage(metadata.photoUrl, {
          imageType: 'Photo',
          personId: person.id,
          isPrimary: true,
          scraperId,
        });
      } catch (error) {
        console.warn('Failed to download person photo:', error);
      }
    }

    res.json({
      message: 'Person metadata refreshed',
      person: updatedPerson,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh person metadata';
    res.status(500).json({ error: message });
  }
});

export default router;
