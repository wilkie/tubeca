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
      for (const [trackId, timescale] of this.timescales) {
        const from = starts.get(trackId);
        if (from === undefined) continue;
        this.offsets.set(trackId, Math.round(this.options.startSeconds * timescale) - from);
      }
    }
    shiftFragmentDecodeTimes(buffer, this.offsets);
    this.options.onMedia(buffer);
  }
}
