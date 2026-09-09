# Segment Indexing (proposed)

> **Not implemented.** This is a design, written up on 2026-09-08 so it can be chosen or rejected
> later on evidence rather than re-derived from scratch. Everything it claims about real files was
> measured on `The Sandman` S01E04 (1.04GB Matroska, H.264 + E-AC-3, 2723s, keyframes ~5.13s apart)
> and is reproduced below; nothing in it is written from memory of how containers work.
>
> The idea: stop producing a copied segment with FFmpeg. Read once where every video sample lives
> inside the source file, keep that index, and afterwards build each segment by reading the source's
> own bytes at those offsets and wrapping them in `moof`/`mdat`. The picture never moves and never
> passes through an encoder or a muxer again.

## Why this exists

The `original` rung copies the picture. It does so by running one FFmpeg process per segment, which
seeks into the source, demuxes it, and remuxes a few seconds of it into fragmented MP4. Every defect
fixed between 2026-09-05 and 2026-09-07 was a consequence of that process boundary — segments
mislabelled against their content, production cost growing with position, an audio encoder priming
delay at each seam, boundaries that missed the file's keyframes. Each was fixed on its own terms and
the rung now works. But the seams are still there, and they are still being managed rather than
removed.

Indexing removes the process. A segment becomes a read.

### What was rejected on the way here

**Remuxing the whole file to fragmented MP4 once, then serving byte ranges of it.** Proposed first,
because it is a single trusted FFmpeg command. Measured: 30.5s wall and 1.9s of CPU to package the
video alone, producing 780MB — of which **779MB is payload and 0.89MB is headers**, and the payload
is a verbatim copy of bytes already on disk. Four of five sampled 192-byte windows taken from deep
inside the packaged payload were found byte-identical in the source container (the fifth straddled a
frame boundary, where Matroska interleaves block headers). It stores roughly a thousand times the
information it adds, and buys only latency that is no longer a problem. Rejected.

## Goals

- **Serve a copied segment without running FFmpeg.** A byte-range read and a header, not a process.
- **Store what is new, not what is already there.** Under 1MB per file, against 845MB for a remux.
- **Keep both properties the current design was built for**: segments shared between viewers, and a
  seek to any point costing the same as a seek to the beginning.
- **Never be the only path.** Anything the index cannot describe falls back to the FFmpeg segment
  builder, which stays exactly as it is.

## What has to be stored

Per media item and video stream:

| | measured / estimated |
|---|---|
| Sample index: offset, size, PTS, DTS, keyframe flag per frame | 65,274 frames; 0.85MB packed at 13 bytes each, 0.86MB as gzipped `ffprobe` CSV |
| Initialisation segment (`ftyp` + `moov`, from the source's codec configuration) | 792 bytes |
| Converted audio, only for the 72% of the library whose audio is not AAC or MP3 | 43–65MB |

A file whose audio is already playable therefore costs under **1MB**. One that needs its audio
converted costs what it already costs today for `preparedAudio`, plus that megabyte. `MediaKeyframes` is
subsumed: the keyframe flags in the index are strictly more information than the keyframe times it
holds now, so that table becomes a projection of this one.

## How the index is built

**The finding that makes this tractable: no EBML parser is needed.** The obvious objection to
indexing a Matroska file is that a frame's bytes are not a clean slice of it — each frame sits
inside a `SimpleBlock` whose header comes first. That is true, but the header is small and fixed,
and `ffprobe` already reports where the block payload begins:

```
$ ffprobe -select_streams v:0 -show_entries packet=pts_time,dts_time,size,pos,flags ...
pts_time=0.000000  size=1224  pos=8654   flags=K__
pts_time=0.709000  size=83    pos=83639  flags=___
```

At `pos` 83639 the source reads `81 02 c5 00 | 00 00 00 07 06 01 ...` — a one-byte track number
(`0x81`, track 1), a two-byte relative timestamp, one byte of flags, and then the frame. So the
sample begins at **`pos + 4`** and runs for exactly `size` bytes. Verified against the remux: the
1224 bytes at `8654 + 4` are byte-identical to the first sample the muxer wrote, at offset 0 of its
payload. `size` excludes the block header, so it needs no adjustment.

The header is four bytes only while the track number fits in one byte (tracks 1–126); above that the
track number is a two-byte VINT and the offset is five. The track number is known from the probe, so
this is arithmetic, not parsing.

An MP4 or M4V source needs no such adjustment: `pos` is already the sample offset, and the same
information is in `stsz`/`stco`/`stts`/`ctts`/`stss` if it is ever worth reading directly.

So: **one `ffprobe` pass over the file**, which is the same full read `probeKeyframes` already does
on first play and which it replaces. Two hundred lines of parsing, no demuxer.

## How a segment is served

1. Look up the segment's sample range in the index — from the first keyframe at its start to the
   sample before the next segment's.
2. Read the byte span covering them and pick the frames out of it. The frames are *not* contiguous
   in the source — audio and, on this file, 35 subtitle tracks are interleaved between them — so a
   segment's samples are scattered across a span wider than their payload. Measured over four
   segments of this episode: **144 frames each, 0.35-2.54MB of payload, spanning 1.24-2.67x that
   much of the file.** One sequential read of the span and a copy of the frames out of it therefore
   costs at most about two and a half times the payload in I/O, and beats 144 small reads over a
   network mount by a wide margin. A file with fewer subtitle tracks amplifies less.
3. Write `moof` (one `traf`, `tfhd` + `tfdt` + `trun` built from the index's sizes and durations)
   followed by `mdat` holding the frames back to back.
4. Append the audio: for a file whose audio is copyable, from the same index applied to the audio
   stream; otherwise from the prepared AAC track, which stays exactly as it is today.

The initialisation segment is built once from the source's codec configuration (`CodecPrivate` in
Matroska, `avcC`/`hvcC`/`av1C` in MP4) — the same bytes `codecStringsFromInit` already reads.

Segment boundaries come from the keyframe flags in the index, cut by the existing `keyframeLayout`
with its nearest-to-target rule. That code is reused unchanged; only its input changes.

## What it deletes

- The per-segment FFmpeg process for 82% of the library, and with it the transcode slot semaphore,
  the prefetch machinery, the cancellation of stale prefetches, and the streaming-as-it-encodes
  path — none of which mean anything when a segment is a file read.
- `COPY_SEEK_PRE_ROLL` and the two-stage seek.
- `AUDIO_COPY_PAD`, since the index knows exactly which audio frames belong to a segment.
- `Fmp4Splitter`'s decode-time rebasing: timestamps come from the index and are already the file's.
- `MediaKeyframes`, subsumed by the sample index.

The transcode ladder is untouched, and keeps using the layout the index produces so that switching
rungs stays aligned.

## Known risks

- **Lacing.** Matroska can pack several frames into one block, and then `pos + 4` is the start of a
  lacing header rather than a frame. Rare for video, common for small audio frames. The block flags
  say when it is in use; the index build must detect it and refuse the file, not guess.
- **Header removal compression.** A track may declare `ContentCompression` with header stripping, so
  that bytes common to every frame are omitted from the stored data and must be prepended. A file
  doing that cannot be sliced. Detect it in the track entry and refuse.
- **`BlockGroup` rather than `SimpleBlock`.** Used when a block needs a duration or reference list.
  The payload layout is the same, but this was not verified on a real file and must be before the
  code trusts it.
- **The failure mode is silent.** A wrong offset produces a segment that decodes to garbage rather
  than an error. The mitigation is a verification pass: for a sample of files, build a segment from
  the index and from FFmpeg and compare the payloads byte for byte, which is exactly the check that
  established `pos + 4` above and is cheap enough to run on every file the first time it is indexed.
- **Index size.** 0.85MB per file over 30,554 files would be ~26GB if every one were ever played,
  which is more than the database should hold. It belongs beside the segments in the HLS cache,
  subject to the same LRU, not in SQLite — and unlike a segment it is cheap to rebuild.
- **Frames are interleaved, so a segment is a span rather than a slice.** See above: acceptable at
  1.24-2.67x amplification here, but a pathological interleave — a file with many large data tracks
  between video frames — would make it worse, and the index knows enough to notice before trying.

## Interactions

- [Streaming, Transcoding & HLS](streaming-and-transcoding.md) — the pipeline this replaces the copy
  path of; its FFmpeg segment builder remains the fallback and the transcode path.
- [Playback Experience](playback.md) — unchanged; the playlists and segment URLs keep their shape.
- [Configuration, Settings & Server Runtime](configuration.md) — would gain one switch, defaulting
  to whichever of the two paths has earned it by then.

## If it is not built

The current design works and is measured: segments cost 0.35s to produce anywhere in a file, audio
is converted once rather than per segment, and boundaries fall on the file's own keyframes. This
document exists because that state was reached by fixing four separate consequences of one
architectural choice, and it is worth having written down what removing the choice would involve
before the fifth consequence turns up.
