import { Router, Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { authenticate } from '../middleware/auth';
import { AuthService } from '../services/authService';
import { MediaService } from '../services/mediaService';
import { HlsService, QUALITY_PRESETS, ORIGINAL_QUALITY } from '../services/hlsService';

const router = Router();
const mediaService = new MediaService();
const authService = new AuthService();
const hlsService = new HlsService();

// Custom auth middleware that also accepts token via query parameter
// This is needed because <video> elements can't set Authorization headers
function streamAuth(req: Request, res: Response, next: NextFunction) {
  // First try query parameter token
  const queryToken = req.query.token as string | undefined;
  if (queryToken) {
    try {
      const payload = authService.verifyToken(queryToken);
      req.user = payload;
      return next();
    } catch {
      // Fall through to try header auth
    }
  }

  // Fall back to header-based auth
  return authenticate(req, res, next);
}

// All streaming routes require authentication
router.use(streamAuth);

/**
 * @openapi
 * /api/stream/video/{id}:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Stream video
 *     description: Stream video content. Supports transcoding for non-native formats and audio track selection.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header for video elements)
 *       - in: query
 *         name: audioTrack
 *         schema:
 *           type: integer
 *         description: Audio stream index to use
 *       - in: query
 *         name: start
 *         schema:
 *           type: number
 *         description: Start time in seconds for seeking (transcoded streams only)
 *     responses:
 *       200:
 *         description: Video stream
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *           video/webm:
 *             schema:
 *               type: string
 *               format: binary
 *       206:
 *         description: Partial content (range request)
 *       404:
 *         description: Video not found
 */
router.get('/video/:id', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoPath = media.path;

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Get file extension to determine if transcoding is needed
    const ext = path.extname(videoPath).toLowerCase();
    const nativeFormat = ['.mp4', '.webm'].includes(ext);

    // Support audio track selection via audioTrack query parameter (stream index)
    const audioTrack = req.query.audioTrack !== undefined
      ? parseInt(req.query.audioTrack as string, 10)
      : undefined;

    // Use FFmpeg if: not a native format OR audio track selection is requested
    const needsTranscode = !nativeFormat || audioTrack !== undefined;

    if (needsTranscode) {
      // Use ffmpeg to transcode to mp4 for browser compatibility
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Support seeking via start query parameter (in seconds)
      const startTime = parseFloat(req.query.start as string) || 0;

      const ffmpegArgs = [];

      // Add seek position before input for faster seeking
      if (startTime > 0) {
        ffmpegArgs.push('-ss', startTime.toString());
      }

      ffmpegArgs.push('-i', videoPath);

      // Map video stream (first video stream)
      ffmpegArgs.push('-map', '0:v:0');

      // Map audio stream (specific track or first audio stream)
      if (audioTrack !== undefined) {
        // Map the specific audio stream by absolute index
        ffmpegArgs.push('-map', `0:${audioTrack}`);
      } else {
        // Default: map first audio stream
        ffmpegArgs.push('-map', '0:a:0?');
      }

      // If source is native format, copy both video AND audio to maintain sync
      // When copying, both streams are cut at the same keyframe boundary
      // If we re-encode audio but copy video, they desync because audio starts
      // at exact seek point but video starts at nearest keyframe
      if (nativeFormat) {
        ffmpegArgs.push('-c:v', 'copy');
        ffmpegArgs.push('-c:a', 'copy');
      } else {
        ffmpegArgs.push(
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency'
        );
        ffmpegArgs.push('-c:a', 'aac');
      }

      // Reset timestamps to start from 0 to avoid negative timestamp issues
      ffmpegArgs.push('-avoid_negative_ts', 'make_zero');

      ffmpegArgs.push(
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        '-'
      );

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);

      ffmpeg.stdout.pipe(res);

      ffmpeg.stderr.on('data', (data) => {
        // Log ffmpeg output for debugging (stderr is used for progress)
        console.log(`ffmpeg: ${data}`);
      });

      ffmpeg.on('error', (err) => {
        console.error('ffmpeg error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Transcoding error' });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          console.error(`ffmpeg exited with code ${code}`);
        }
      });

      // Handle client disconnect
      req.on('close', () => {
        ffmpeg.kill('SIGKILL');
      });
    } else {
      // For mp4/webm, support range requests for seeking
      const contentType = ext === '.webm' ? 'video/webm' : 'video/mp4';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });

        const stream = fs.createReadStream(videoPath, { start, end });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
        });

        fs.createReadStream(videoPath).pipe(res);
      }
    }
  } catch (error) {
    console.error('Streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream video' });
    }
  }
});

/**
 * @openapi
 * /api/stream/subtitles/{id}:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Stream subtitles
 *     description: Extract and stream subtitles as WebVTT format
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *       - in: query
 *         name: streamIndex
 *         required: true
 *         schema:
 *           type: integer
 *         description: Subtitle stream index to extract
 *     responses:
 *       200:
 *         description: WebVTT subtitle stream
 *         content:
 *           text/vtt:
 *             schema:
 *               type: string
 *       400:
 *         description: streamIndex parameter is required
 *       404:
 *         description: Video not found
 */
router.get('/subtitles/:id', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoPath = media.path;

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    // Get subtitle stream index from query parameter
    const streamIndex = req.query.streamIndex !== undefined
      ? parseInt(req.query.streamIndex as string, 10)
      : undefined;

    if (streamIndex === undefined) {
      return res.status(400).json({ error: 'streamIndex query parameter is required' });
    }

    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    // Use ffmpeg to extract and convert subtitle to WebVTT
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-map', `0:${streamIndex}`,
      '-c:s', 'webvtt',
      '-f', 'webvtt',
      '-'
    ]);

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
      // Log ffmpeg output for debugging
      console.log(`ffmpeg subtitles: ${data}`);
    });

    ffmpeg.on('error', (err) => {
      console.error('ffmpeg subtitle error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Subtitle extraction error' });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error(`ffmpeg subtitles exited with code ${code}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to extract subtitles' });
        }
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      ffmpeg.kill('SIGKILL');
    });
  } catch (error) {
    console.error('Subtitle streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream subtitles' });
    }
  }
});

/**
 * @openapi
 * /api/stream/audio/{id}:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Stream audio
 *     description: Stream audio content with range request support
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *     responses:
 *       200:
 *         description: Audio stream
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           audio/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *           audio/flac:
 *             schema:
 *               type: string
 *               format: binary
 *       206:
 *         description: Partial content (range request)
 *       404:
 *         description: Audio not found
 */
router.get('/audio/:id', async (req, res) => {
  try {
    const media = await mediaService.getAudioById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const audioPath = media.path;

    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const stat = fs.statSync(audioPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const ext = path.extname(audioPath).toLowerCase();

    // Determine content type
    const contentTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
    };
    const contentType = contentTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      const stream = fs.createReadStream(audioPath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      });

      fs.createReadStream(audioPath).pipe(res);
    }
  } catch (error) {
    console.error('Audio streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  }
});

/**
 * @openapi
 * /api/stream/trickplay/{id}:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get trickplay metadata
 *     description: Get metadata about available trickplay thumbnails for scrubbing preview
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *     responses:
 *       200:
 *         description: Trickplay metadata
 *       404:
 *         description: Media not found or no trickplay available
 */
router.get('/trickplay/:id', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    if (!media.thumbnails) {
      return res.json({
        trickplay: {
          available: false,
          resolutions: [],
        },
      });
    }

    const trickplayPath = media.thumbnails;

    if (!fs.existsSync(trickplayPath)) {
      return res.json({
        trickplay: {
          available: false,
          resolutions: [],
        },
      });
    }

    // Read the trickplay directory to find available resolutions
    // Format: "{width} - {columns}x{rows}" e.g., "320 - 10x10"
    const entries = fs.readdirSync(trickplayPath, { withFileTypes: true });
    const resolutions = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Parse folder name: "{width} - {columns}x{rows}"
      const match = entry.name.match(/^(\d+)\s*-\s*(\d+)x(\d+)$/);
      if (!match) continue;

      const width = parseInt(match[1], 10);
      const columns = parseInt(match[2], 10);
      const rows = parseInt(match[3], 10);
      const tilesPerSprite = columns * rows;

      // Count sprite files (0.jpg, 1.jpg, etc.)
      const resolutionPath = path.join(trickplayPath, entry.name);
      const files = fs.readdirSync(resolutionPath);
      const spriteFiles = files.filter((f) => /^\d+\.jpg$/.test(f));
      const spriteCount = spriteFiles.length;

      if (spriteCount === 0) continue;

      // Read actual image dimensions from the first sprite
      const firstSpritePath = path.join(resolutionPath, '0.jpg');
      let tileWidth = width;
      let tileHeight = Math.round(width * (9 / 16)); // Fallback to 16:9 aspect ratio

      try {
        const metadata = await sharp(firstSpritePath).metadata();
        if (metadata.width && metadata.height) {
          tileWidth = Math.floor(metadata.width / columns);
          tileHeight = Math.floor(metadata.height / rows);
        }
      } catch (imgError) {
        console.warn(`Could not read sprite dimensions from ${firstSpritePath}:`, imgError);
      }

      resolutions.push({
        width,
        tileWidth,
        tileHeight,
        tileCount: tilesPerSprite,
        interval: 10, // 10 seconds between frames as specified
        spriteCount,
        columns,
        rows,
      });
    }

    // Sort by width (prefer larger resolution)
    resolutions.sort((a, b) => b.width - a.width);

    return res.json({
      trickplay: {
        available: resolutions.length > 0,
        resolutions,
      },
    });
  } catch (error) {
    console.error('Trickplay metadata error:', error);
    return res.status(500).json({ error: 'Failed to get trickplay metadata' });
  }
});

/**
 * @openapi
 * /api/stream/trickplay/{id}/{width}/{index}:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get trickplay sprite image
 *     description: Get a specific trickplay sprite sheet image
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: width
 *         required: true
 *         schema:
 *           type: integer
 *         description: Thumbnail width resolution
 *       - in: path
 *         name: index
 *         required: true
 *         schema:
 *           type: integer
 *         description: Sprite sheet index (0, 1, 2, etc.)
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *     responses:
 *       200:
 *         description: Sprite sheet image
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Sprite not found
 */
router.get('/trickplay/:id/:width/:index', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    if (!media.thumbnails) {
      return res.status(404).json({ error: 'No trickplay available' });
    }

    const trickplayPath = media.thumbnails;
    const requestedWidth = parseInt(req.params.width, 10);
    const spriteIndex = parseInt(req.params.index, 10);

    // Find the matching resolution folder
    const entries = fs.readdirSync(trickplayPath, { withFileTypes: true });
    let resolutionFolder: string | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const match = entry.name.match(/^(\d+)\s*-\s*\d+x\d+$/);
      if (match && parseInt(match[1], 10) === requestedWidth) {
        resolutionFolder = entry.name;
        break;
      }
    }

    if (!resolutionFolder) {
      return res.status(404).json({ error: 'Resolution not found' });
    }

    const spritePath = path.join(trickplayPath, resolutionFolder, `${spriteIndex}.jpg`);

    if (!fs.existsSync(spritePath)) {
      return res.status(404).json({ error: 'Sprite not found' });
    }

    const stat = fs.statSync(spritePath);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    fs.createReadStream(spritePath).pipe(res);
  } catch (error) {
    console.error('Trickplay sprite error:', error);
    return res.status(500).json({ error: 'Failed to get trickplay sprite' });
  }
});

// ============================================
// HLS Streaming Routes
// ============================================

/**
 * @openapi
 * /api/stream/hls/{id}/master.m3u8:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get HLS master playlist
 *     description: Returns master playlist listing all available quality levels
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *       - in: query
 *         name: audioTrack
 *         schema:
 *           type: integer
 *         description: Audio stream index to use
 *     responses:
 *       200:
 *         description: HLS master playlist
 *         content:
 *           application/vnd.apple.mpegurl:
 *             schema:
 *               type: string
 *       404:
 *         description: Media not found
 */
router.get('/hls/:id/master.m3u8', async (req, res) => {
  try {
    const audioTrack = req.query.audioTrack !== undefined
      ? parseInt(req.query.audioTrack as string, 10)
      : undefined;

    const playlist = await hlsService.generateMasterPlaylist(req.params.id, audioTrack);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(playlist);
  } catch (error) {
    console.error('HLS master playlist error:', error);
    if ((error as Error).message === 'Media not found') {
      return res.status(404).json({ error: 'Media not found' });
    }
    return res.status(500).json({ error: 'Failed to generate master playlist' });
  }
});

/**
 * @openapi
 * /api/stream/hls/{id}/{quality}.m3u8:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get HLS variant playlist
 *     description: Returns variant playlist for a specific quality level
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: quality
 *         required: true
 *         schema:
 *           type: string
 *           enum: [original, 1080p, 720p, 480p, 360p]
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token
 *       - in: query
 *         name: audioTrack
 *         schema:
 *           type: string
 *         description: Audio track identifier
 *     responses:
 *       200:
 *         description: HLS variant playlist
 *         content:
 *           application/vnd.apple.mpegurl:
 *             schema:
 *               type: string
 *       404:
 *         description: Media not found
 */
router.get('/hls/:id/:quality.m3u8', async (req, res) => {
  try {
    const { id, quality } = req.params;
    const audioTrack = (req.query.audioTrack as string) || 'default';

    // Validate quality
    if (quality !== ORIGINAL_QUALITY && !QUALITY_PRESETS[quality]) {
      return res.status(400).json({ error: 'Invalid quality level' });
    }

    const playlist = await hlsService.generateVariantPlaylist(id, quality, audioTrack);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(playlist);
  } catch (error) {
    console.error('HLS variant playlist error:', error);
    if ((error as Error).message === 'Media not found') {
      return res.status(404).json({ error: 'Media not found' });
    }
    return res.status(500).json({ error: 'Failed to generate variant playlist' });
  }
});

/**
 * @openapi
 * /api/stream/hls/{id}/{quality}/{segment}.ts:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get HLS segment
 *     description: Returns a specific video segment (generates on-demand if not cached)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: quality
 *         required: true
 *         schema:
 *           type: string
 *           enum: [original, 1080p, 720p, 480p, 360p]
 *       - in: path
 *         name: segment
 *         required: true
 *         schema:
 *           type: integer
 *         description: Segment index (0, 1, 2, etc.)
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token
 *       - in: query
 *         name: audioTrack
 *         schema:
 *           type: string
 *         description: Audio track identifier
 *     responses:
 *       200:
 *         description: MPEG-TS segment
 *         content:
 *           video/mp2t:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Segment not found
 */
router.get('/hls/:id/:quality/:segment.ts', async (req, res) => {
  try {
    const { id, quality, segment } = req.params;
    const audioTrack = (req.query.audioTrack as string) || 'default';
    const segmentIndex = parseInt(segment, 10);

    // Validate quality
    if (quality !== ORIGINAL_QUALITY && !QUALITY_PRESETS[quality]) {
      return res.status(400).json({ error: 'Invalid quality level' });
    }

    if (isNaN(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ error: 'Invalid segment index' });
    }

    const segmentPath = await hlsService.getSegment(id, quality, segmentIndex, audioTrack);

    if (!segmentPath) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    const stat = fs.statSync(segmentPath);
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache segments for 1 hour

    fs.createReadStream(segmentPath).pipe(res);
  } catch (error) {
    console.error('HLS segment error:', error);
    return res.status(500).json({ error: 'Failed to get segment' });
  }
});

/**
 * @openapi
 * /api/stream/hls/{id}/qualities:
 *   get:
 *     tags:
 *       - Streaming
 *     summary: Get available qualities
 *     description: Returns list of available quality levels for a media item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token
 *     responses:
 *       200:
 *         description: Available qualities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qualities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       width:
 *                         type: integer
 *                       height:
 *                         type: integer
 *                       bitrate:
 *                         type: integer
 */
router.get('/hls/:id/qualities', async (req, res) => {
  try {
    const availableQualities = await hlsService.getAvailableQualities(req.params.id);

    const qualities = availableQualities.map(q => {
      if (q === ORIGINAL_QUALITY) {
        return {
          name: ORIGINAL_QUALITY,
          label: 'Original',
          width: null,
          height: null,
          bitrate: null,
        };
      }
      const preset = QUALITY_PRESETS[q];
      return {
        name: q,
        label: preset.label,
        width: preset.width,
        height: preset.height,
        bitrate: preset.videoBitrate + preset.audioBitrate,
      };
    });

    res.json({ qualities });
  } catch (error) {
    console.error('HLS qualities error:', error);
    return res.status(500).json({ error: 'Failed to get qualities' });
  }
});

export default router;
