/**
 * Fragmented-MP4 (CMAF) plumbing for the `original` HLS rung.
 *
 * FFmpeg, asked for fragmented MP4 on a pipe, writes one continuous stream:
 * `ftyp moov moof mdat [moof mdat ...] mfra`. HLS wants that split in two — the
 * `ftyp moov` header served once as an `#EXT-X-MAP` initialisation segment, and
 * each `moof mdat` run served as a media segment. It also wants every media
 * segment to say where it sits on the timeline, and FFmpeg always numbers a
 * fragment run from zero because each of our segments is its own FFmpeg process
 * that knows nothing of the ones before it.
 *
 * `Fmp4Splitter` does both as the bytes arrive: it peels the header off, rebases
 * every fragment's decode time onto the segment's real start, and passes `mdat`
 * through without holding it, so a segment still reaches the player while it is
 * being written.
 */

interface BoxHeader {
  type: string
  /** Total box size including the header */
  size: number
  /** Bytes of header consumed */
  headerSize: number
}

/** Read a box header, or null when `buffer` does not yet hold a whole one. */
function readBoxHeader(buffer: Buffer, offset: number): BoxHeader | null {
  if (buffer.length - offset < 8) return null;
  const size32 = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  if (size32 === 1) {
    if (buffer.length - offset < 16) return null;
    return { type, size: Number(buffer.readBigUInt64BE(offset + 8)), headerSize: 16 };
  }
  return { type, size: size32, headerSize: 8 };
}

/** Every top-level box in a complete buffer, in order. */
export function topLevelBoxes(buffer: Buffer): { type: string; start: number; size: number }[] {
  const boxes: { type: string; start: number; size: number }[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const header = readBoxHeader(buffer, offset);
    // A size of 0 means "to the end of the file"; anything smaller than the
    // header is corrupt, and walking on would loop forever.
    if (!header || header.size < header.headerSize) {
      if (header && header.size === 0) boxes.push({ type: header.type, start: offset, size: buffer.length - offset });
      break;
    }
    boxes.push({ type: header.type, start: offset, size: header.size });
    offset += header.size;
  }
  return boxes;
}

/** Direct children of a container box whose payload starts at `start`. */
function childBoxes(buffer: Buffer, start: number, end: number) {
  const boxes: { type: string; start: number; size: number; headerSize: number }[] = [];
  let offset = start;
  while (offset < end) {
    const header = readBoxHeader(buffer, offset);
    if (!header || header.size < header.headerSize || offset + header.size > end) break;
    boxes.push({ type: header.type, start: offset, size: header.size, headerSize: header.headerSize });
    offset += header.size;
  }
  return boxes;
}

/**
 * Track id to media timescale, read from an initialisation segment. Decode
 * times are expressed in these units, and they differ per track — video is
 * commonly 90000 or the frame rate, audio the sample rate.
 */
export function readTrackTimescales(init: Buffer): Map<number, number> {
  const timescales = new Map<number, number>();
  const moov = topLevelBoxes(init).find((b) => b.type === 'moov');
  if (!moov) return timescales;

  for (const trak of childBoxes(init, moov.start + 8, moov.start + moov.size)) {
    if (trak.type !== 'trak') continue;
    let trackId: number | null = null;
    let timescale: number | null = null;

    for (const child of childBoxes(init, trak.start + trak.headerSize, trak.start + trak.size)) {
      if (child.type === 'tkhd') {
        const version = init.readUInt8(child.start + child.headerSize);
        // version 0: 32-bit creation and modification times, version 1: 64-bit
        const idOffset = child.start + child.headerSize + 4 + (version === 1 ? 16 : 8);
        if (idOffset + 4 <= child.start + child.size) trackId = init.readUInt32BE(idOffset);
      } else if (child.type === 'mdia') {
        for (const inner of childBoxes(init, child.start + child.headerSize, child.start + child.size)) {
          if (inner.type !== 'mdhd') continue;
          const version = init.readUInt8(inner.start + inner.headerSize);
          const scaleOffset = inner.start + inner.headerSize + 4 + (version === 1 ? 16 : 8);
          if (scaleOffset + 4 <= inner.start + inner.size) timescale = init.readUInt32BE(scaleOffset);
        }
      }
    }

    if (trackId !== null && timescale) timescales.set(trackId, timescale);
  }
  return timescales;
}

/** The `tfdt` decode time of each track in a `moof`, keyed by track id. */
export function readFragmentDecodeTimes(moof: Buffer): Map<number, number> {
  const times = new Map<number, number>();
  const header = readBoxHeader(moof, 0);
  if (!header) return times;

  for (const traf of childBoxes(moof, header.headerSize, moof.length)) {
    if (traf.type !== 'traf') continue;
    let trackId: number | null = null;
    let decodeTime: number | null = null;
    for (const child of childBoxes(moof, traf.start + traf.headerSize, traf.start + traf.size)) {
      if (child.type === 'tfhd') {
        trackId = moof.readUInt32BE(child.start + child.headerSize + 4);
      } else if (child.type === 'tfdt') {
        const version = moof.readUInt8(child.start + child.headerSize);
        const valueAt = child.start + child.headerSize + 4;
        decodeTime = version === 1 ? Number(moof.readBigUInt64BE(valueAt)) : moof.readUInt32BE(valueAt);
      }
    }
    if (trackId !== null && decodeTime !== null) times.set(trackId, decodeTime);
  }
  return times;
}

/**
 * Add `offsets` (in each track's own timescale) to the decode times in a
 * `moof`, in place. A track with no offset is left alone; a 32-bit `tfdt` that
 * would overflow is left alone too, since the box cannot grow without moving
 * everything after it.
 */
export function shiftFragmentDecodeTimes(moof: Buffer, offsets: Map<number, number>): void {
  const header = readBoxHeader(moof, 0);
  if (!header) return;

  for (const traf of childBoxes(moof, header.headerSize, moof.length)) {
    if (traf.type !== 'traf') continue;
    const children = childBoxes(moof, traf.start + traf.headerSize, traf.start + traf.size);
    const tfhd = children.find((c) => c.type === 'tfhd');
    const tfdt = children.find((c) => c.type === 'tfdt');
    if (!tfhd || !tfdt) continue;

    const trackId = moof.readUInt32BE(tfhd.start + tfhd.headerSize + 4);
    const offset = offsets.get(trackId);
    if (!offset) continue;

    const version = moof.readUInt8(tfdt.start + tfdt.headerSize);
    const valueAt = tfdt.start + tfdt.headerSize + 4;
    if (version === 1) {
      const shifted = moof.readBigUInt64BE(valueAt) + BigInt(offset);
      moof.writeBigUInt64BE(shifted < 0n ? 0n : shifted, valueAt);
    } else {
      const shifted = moof.readUInt32BE(valueAt) + offset;
      if (shifted >= 0 && shifted <= 0xffffffff) moof.writeUInt32BE(shifted, valueAt);
    }
  }
}

/**
 * RFC 6381 codec strings for the tracks in an initialisation segment, in track
 * order, ready for a playlist's `CODECS` attribute.
 *
 * These are read from the sample entries themselves rather than derived from a
 * codec name, because a name does not say whether a player can decode the
 * stream: `hvc1.2.4.L150.B0` is Main 10 at level 5.0, and a browser that plays
 * `hvc1.1.6.L120.B0` may well refuse it. A track whose sample entry is not
 * recognised is left out rather than guessed at.
 */
export function codecStringsFromInit(init: Buffer): string[] {
  const codecs: string[] = [];
  const moov = topLevelBoxes(init).find((b) => b.type === 'moov');
  if (!moov) return codecs;

  for (const trak of childBoxes(init, moov.start + 8, moov.start + moov.size)) {
    if (trak.type !== 'trak') continue;
    const stsd = descend(init, trak, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!stsd) continue;
    // stsd is a full box with an entry count before the sample entries.
    for (const entry of childBoxes(init, stsd.start + stsd.headerSize + 8, stsd.start + stsd.size)) {
      const codec = codecStringFor(init, entry);
      if (codec) codecs.push(codec);
    }
  }
  return codecs;
}

interface Box { type: string; start: number; size: number; headerSize: number }

/** Follow a chain of box types down from a container. */
function descend(buffer: Buffer, from: Box, path: string[]): Box | null {
  let current: Box | null = from;
  for (const type of path) {
    if (!current) return null;
    current =
      childBoxes(buffer, current.start + current.headerSize, current.start + current.size).find(
        (b) => b.type === type
      ) ?? null;
  }
  return current;
}

/** Bytes an audio or visual sample entry reserves before its child boxes. */
const VISUAL_SAMPLE_ENTRY_HEADER = 78;
const AUDIO_SAMPLE_ENTRY_HEADER = 28;

function codecStringFor(buffer: Buffer, entry: Box): string | null {
  const configOf = (type: string, reserved: number) => {
    const start = entry.start + entry.headerSize + reserved;
    return childBoxes(buffer, start, entry.start + entry.size).find((b) => b.type === type) ?? null;
  };

  switch (entry.type) {
    case 'avc1':
    case 'avc3': {
      const avcC = configOf('avcC', VISUAL_SAMPLE_ENTRY_HEADER);
      if (!avcC) return null;
      // configurationVersion, profile, compatibility, level
      const at = avcC.start + avcC.headerSize + 1;
      const hex = (offset: number) => buffer.readUInt8(at + offset).toString(16).padStart(2, '0');
      return `${entry.type}.${hex(0)}${hex(1)}${hex(2)}`;
    }
    case 'hvc1':
    case 'hev1': {
      const hvcC = configOf('hvcC', VISUAL_SAMPLE_ENTRY_HEADER);
      if (!hvcC) return null;
      const at = hvcC.start + hvcC.headerSize + 1;
      const first = buffer.readUInt8(at);
      const profileSpace = first >> 6;
      const tier = (first >> 5) & 1;
      const profile = first & 0x1f;
      // The compatibility flags are written most-significant bit first and
      // read back as a bit-reversed integer, then printed without leading zeros.
      const compatibility = reverseBits32(buffer.readUInt32BE(at + 1));
      const constraints: string[] = [];
      for (let i = 0; i < 6; i++) constraints.push(buffer.readUInt8(at + 5 + i).toString(16));
      while (constraints.length > 0 && constraints[constraints.length - 1] === '0') constraints.pop();
      const level = buffer.readUInt8(at + 11);
      const space = profileSpace === 0 ? '' : String.fromCharCode('A'.charCodeAt(0) + profileSpace - 1);
      const parts = [
        entry.type,
        `${space}${profile}`,
        compatibility.toString(16).toUpperCase(),
        `${tier ? 'H' : 'L'}${level}`,
        ...constraints.map((c) => c.toUpperCase().padStart(2, '0')),
      ];
      return parts.join('.');
    }
    case 'av01': {
      const av1C = configOf('av1C', VISUAL_SAMPLE_ENTRY_HEADER);
      if (!av1C) return null;
      const at = av1C.start + av1C.headerSize + 1;
      const first = buffer.readUInt8(at);
      const profile = first >> 5;
      const level = first & 0x1f;
      const second = buffer.readUInt8(at + 1);
      const tier = (second >> 7) & 1;
      const highBitDepth = (second >> 6) & 1;
      const twelveBit = (second >> 5) & 1;
      const depth = twelveBit ? 12 : highBitDepth ? 10 : 8;
      return `av01.${profile}.${level.toString().padStart(2, '0')}${tier ? 'H' : 'M'}.${depth
        .toString()
        .padStart(2, '0')}`;
    }
    // An `mp4a` entry is whatever its elementary stream descriptor says it is:
    // AAC of some profile, or an MP3 stream carried in MP4.
    case 'mp4a': {
      const esds = configOf('esds', AUDIO_SAMPLE_ENTRY_HEADER);
      return esds
        ? mp4aCodecString(buffer, esds.start + esds.headerSize + 4, esds.start + esds.size)
        : 'mp4a.40.2';
    }
    case 'ac-3':
    case 'ec-3':
      return entry.type;
    case 'Opus':
      return 'opus';
    case 'fLaC':
      return 'flac';
    default:
      return null;
  }
}

/**
 * The codec string for an `mp4a` sample entry, read from its ES descriptor.
 * MPEG-4 Audio (0x40) is spelled with its audio object type — 2 for AAC-LC, 5
 * for HE-AAC — and an MP3 stream carried in MP4 by its own object type instead.
 */
function mp4aCodecString(buffer: Buffer, start: number, end: number): string {
  let offset = start;
  let objectType: number | null = null;

  while (offset < end) {
    const tag = buffer.readUInt8(offset++);
    // Descriptor lengths are seven bits per byte, high bit meaning "more".
    let length = 0;
    for (let i = 0; i < 4 && offset < end; i++) {
      const byte = buffer.readUInt8(offset++);
      length = (length << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    if (tag === 0x03) {
      // ES_Descriptor: an id and a flags byte, then the descriptors we want.
      // The flags may add a dependency id, a URL or an OCR id before them.
      const flags = buffer.readUInt8(offset + 2);
      offset += 3;
      if (flags & 0x80) offset += 2;
      if (flags & 0x40) offset += 1 + buffer.readUInt8(offset);
      if (flags & 0x20) offset += 2;
      continue;
    }
    if (tag === 0x04) {
      objectType = buffer.readUInt8(offset);
      // objectTypeIndication, streamType, buffer size, max and average bitrate
      offset += 13;
      continue;
    }
    if (tag === 0x05 && objectType === 0x40 && offset < end) {
      const audioObjectType = buffer.readUInt8(offset) >> 3;
      return `mp4a.40.${audioObjectType}`;
    }
    offset += length;
  }

  if (objectType === null) return 'mp4a.40.2';
  return objectType === 0x40
    ? 'mp4a.40.2'
    : `mp4a.${objectType.toString(16).toUpperCase().padStart(2, '0')}`;
}

function reverseBits32(value: number): number {
  let out = 0;
  for (let i = 0; i < 32; i++) {
    out = (out << 1) | ((value >>> i) & 1);
  }
  return out >>> 0;
}

export interface Fmp4SplitterOptions {
  /**
   * Where this segment starts in the file, in seconds. Every fragment's decode
   * time is rebased so the segment lands here on the player's timeline instead
   * of at zero, which is where FFmpeg puts the first fragment of every run.
   */
  startSeconds: number
  /** Called once, with `ftyp`+`moov`, as soon as the header is complete. */
  onInit: (init: Buffer) => void
  /** Called with the media segment's bytes, in order, as they become available. */
  onMedia: (chunk: Buffer) => void
}

type BoxMode = 'collect' | 'pass' | 'drop';

/**
 * Splits FFmpeg's fragmented-MP4 output into an initialisation segment and a
 * media segment, rewriting decode times as it goes. Feed it with `write` and
 * finish with `end`.
 */
export class Fmp4Splitter {
  private pending: Buffer = Buffer.alloc(0);
  private initParts: Buffer[] = [];
  private initSent = false;
  private timescales = new Map<number, number>();
  private offsets: Map<number, number> | null = null;

  /** The box being read, once its header has arrived. */
  private box: { type: string; mode: BoxMode; remaining: number; parts: Buffer[] } | null = null;

  constructor(private readonly options: Fmp4SplitterOptions) {}

  write(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    this.consume();
  }

  end(): void {
    this.consume();
    this.pending = Buffer.alloc(0);
  }

  private consume(): void {
    for (;;) {
      if (!this.box) {
        const header = readBoxHeader(this.pending, 0);
        if (!header) return;
        if (header.size < header.headerSize) {
          // Unparseable: stop rather than loop on the same bytes.
          this.pending = Buffer.alloc(0);
          return;
        }
        const mode = this.modeFor(header.type);
        this.box = {
          type: header.type,
          mode,
          remaining: header.size,
          parts: [],
        };
      }

      if (this.pending.length === 0) return;
      const take = Math.min(this.box.remaining, this.pending.length);
      const piece = this.pending.subarray(0, take);
      this.pending = this.pending.subarray(take);
      this.box.remaining -= take;

      if (this.box.mode === 'collect') {
        this.box.parts.push(Buffer.from(piece));
      } else if (this.box.mode === 'pass') {
        // `mdat` can be megabytes; hand it straight on rather than holding it.
        this.options.onMedia(Buffer.from(piece));
      }

      if (this.box.remaining > 0) return;
      const finished = this.box;
      this.box = null;
      if (finished.mode === 'collect') this.finishCollected(finished.type, Buffer.concat(finished.parts));
    }
  }

  private modeFor(type: string): BoxMode {
    if (type === 'ftyp' || type === 'moov' || type === 'moof') return 'collect';
    // An index of the fragments in this run, written at the end. It describes
    // one segment's worth of a timeline the player already has from the
    // playlist, and nothing reads it here.
    if (type === 'mfra' || type === 'free' || type === 'skip') return 'drop';
    return 'pass';
  }

  private finishCollected(type: string, buffer: Buffer): void {
    if (type === 'ftyp' || type === 'moov') {
      this.initParts.push(buffer);
      if (type === 'moov') {
        const init = Buffer.concat(this.initParts);
        this.timescales = readTrackTimescales(init);
        if (!this.initSent) {
          this.initSent = true;
          this.options.onInit(init);
        }
      }
      return;
    }

    // moof: rebase onto the segment's real start the first time, then keep
    // every later fragment in the run the same distance along.
    if (!this.offsets) {
      this.offsets = new Map();
      const starts = readFragmentDecodeTimes(buffer);

      // One shift for the whole run, measured in seconds, rather than one per
      // track. FFmpeg happens to start every track's decode time at zero, so
      // per-track deltas come out identical and nothing is wrong today; a
      // presentation offset between tracks lives in `ctts`, not here. But the
      // per-track form only worked by that coincidence: any muxer that starts
      // two tracks at different decode times would have had them dragged to the
      // same instant, which is a lip-sync error by construction.
      let earliest: number | undefined;
      for (const [trackId, timescale] of this.timescales) {
        const from = starts.get(trackId);
        if (from === undefined || !timescale) continue;
        const seconds = from / timescale;
        if (earliest === undefined || seconds < earliest) earliest = seconds;
      }
      if (earliest === undefined) earliest = 0;
      const shiftSeconds = this.options.startSeconds - earliest;

      for (const [trackId, timescale] of this.timescales) {
        if (starts.get(trackId) === undefined) continue;
        this.offsets.set(trackId, Math.round(shiftSeconds * timescale));
      }
    }
    shiftFragmentDecodeTimes(buffer, this.offsets);
    this.options.onMedia(buffer);
  }
}
