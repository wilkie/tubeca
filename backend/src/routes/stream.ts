import { Router, Request, Response, NextFunction } from 'express'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { authenticate } from '../middleware/auth'
import { AuthService } from '../services/authService'
import { MediaService } from '../services/mediaService'

const router = Router()
const mediaService = new MediaService()
const authService = new AuthService()

// Custom auth middleware that also accepts token via query parameter
// This is needed because <video> elements can't set Authorization headers
function streamAuth(req: Request, res: Response, next: NextFunction) {
  // First try query parameter token
  const queryToken = req.query.token as string | undefined
  if (queryToken) {
    try {
      const payload = authService.verifyToken(queryToken)
      req.user = payload
      return next()
    } catch {
      // Fall through to try header auth
    }
  }

  // Fall back to header-based auth
  return authenticate(req, res, next)
}

// All streaming routes require authentication
router.use(streamAuth)

// Stream video using ffmpeg
router.get('/video/:id', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Video not found' })
    }

    const videoPath = media.path

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found' })
    }

    const stat = fs.statSync(videoPath)
    const fileSize = stat.size
    const range = req.headers.range

    // Get file extension to determine if transcoding is needed
    const ext = path.extname(videoPath).toLowerCase()
    const nativeFormat = ['.mp4', '.webm'].includes(ext)

    // Support audio track selection via audioTrack query parameter (stream index)
    const audioTrack = req.query.audioTrack !== undefined
      ? parseInt(req.query.audioTrack as string, 10)
      : undefined

    // Use FFmpeg if: not a native format OR audio track selection is requested
    const needsTranscode = !nativeFormat || audioTrack !== undefined

    if (needsTranscode) {
      // Use ffmpeg to transcode to mp4 for browser compatibility
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Transfer-Encoding', 'chunked')

      // Support seeking via start query parameter (in seconds)
      const startTime = parseFloat(req.query.start as string) || 0

      const ffmpegArgs = []

      // Add seek position before input for faster seeking
      if (startTime > 0) {
        ffmpegArgs.push('-ss', startTime.toString())
      }

      ffmpegArgs.push('-i', videoPath)

      // Map video stream (first video stream)
      ffmpegArgs.push('-map', '0:v:0')

      // Map audio stream (specific track or first audio stream)
      if (audioTrack !== undefined) {
        // Map the specific audio stream by absolute index
        ffmpegArgs.push('-map', `0:${audioTrack}`)
      } else {
        // Default: map first audio stream
        ffmpegArgs.push('-map', '0:a:0?')
      }

      // If source is native format, copy video stream to avoid re-encoding
      if (nativeFormat) {
        ffmpegArgs.push('-c:v', 'copy')
      } else {
        ffmpegArgs.push(
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency'
        )
      }

      ffmpegArgs.push(
        '-c:a', 'aac',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        '-'
      )

      const ffmpeg = spawn('ffmpeg', ffmpegArgs)

      ffmpeg.stdout.pipe(res)

      ffmpeg.stderr.on('data', (data) => {
        // Log ffmpeg output for debugging (stderr is used for progress)
        console.log(`ffmpeg: ${data}`)
      })

      ffmpeg.on('error', (err) => {
        console.error('ffmpeg error:', err)
        if (!res.headersSent) {
          res.status(500).json({ error: 'Transcoding error' })
        }
      })

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          console.error(`ffmpeg exited with code ${code}`)
        }
      })

      // Handle client disconnect
      req.on('close', () => {
        ffmpeg.kill('SIGKILL')
      })
    } else {
      // For mp4/webm, support range requests for seeking
      const contentType = ext === '.webm' ? 'video/webm' : 'video/mp4'

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        })

        const stream = fs.createReadStream(videoPath, { start, end })
        stream.pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
        })

        fs.createReadStream(videoPath).pipe(res)
      }
    }
  } catch (error) {
    console.error('Streaming error:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream video' })
    }
  }
})

// Stream subtitles as WebVTT
router.get('/subtitles/:id', async (req, res) => {
  try {
    const media = await mediaService.getVideoById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Video not found' })
    }

    const videoPath = media.path

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found' })
    }

    // Get subtitle stream index from query parameter
    const streamIndex = req.query.streamIndex !== undefined
      ? parseInt(req.query.streamIndex as string, 10)
      : undefined

    if (streamIndex === undefined) {
      return res.status(400).json({ error: 'streamIndex query parameter is required' })
    }

    res.setHeader('Content-Type', 'text/vtt')
    res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour

    // Use ffmpeg to extract and convert subtitle to WebVTT
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-map', `0:${streamIndex}`,
      '-c:s', 'webvtt',
      '-f', 'webvtt',
      '-'
    ])

    ffmpeg.stdout.pipe(res)

    ffmpeg.stderr.on('data', (data) => {
      // Log ffmpeg output for debugging
      console.log(`ffmpeg subtitles: ${data}`)
    })

    ffmpeg.on('error', (err) => {
      console.error('ffmpeg subtitle error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Subtitle extraction error' })
      }
    })

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error(`ffmpeg subtitles exited with code ${code}`)
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to extract subtitles' })
        }
      }
    })

    // Handle client disconnect
    req.on('close', () => {
      ffmpeg.kill('SIGKILL')
    })
  } catch (error) {
    console.error('Subtitle streaming error:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream subtitles' })
    }
  }
})

// Stream audio
router.get('/audio/:id', async (req, res) => {
  try {
    const media = await mediaService.getAudioById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Audio not found' })
    }

    const audioPath = media.path

    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: 'Audio file not found' })
    }

    const stat = fs.statSync(audioPath)
    const fileSize = stat.size
    const range = req.headers.range
    const ext = path.extname(audioPath).toLowerCase()

    // Determine content type
    const contentTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
    }
    const contentType = contentTypes[ext] || 'audio/mpeg'

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      })

      const stream = fs.createReadStream(audioPath, { start, end })
      stream.pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      })

      fs.createReadStream(audioPath).pipe(res)
    }
  } catch (error) {
    console.error('Audio streaming error:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' })
    }
  }
})

export default router
