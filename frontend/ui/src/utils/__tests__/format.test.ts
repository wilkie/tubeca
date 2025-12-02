import { formatDuration } from '../format';

describe('formatDuration', () => {
  describe('seconds only', () => {
    it('formats 0 seconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('formats single digit seconds', () => {
      expect(formatDuration(5)).toBe('5s');
    });

    it('formats double digit seconds', () => {
      expect(formatDuration(45)).toBe('45s');
    });

    it('formats 59 seconds without minutes', () => {
      expect(formatDuration(59)).toBe('59s');
    });
  });

  describe('minutes and seconds', () => {
    it('formats exactly 1 minute', () => {
      expect(formatDuration(60)).toBe('1m 0s');
    });

    it('formats minutes with seconds', () => {
      expect(formatDuration(90)).toBe('1m 30s');
    });

    it('formats double digit minutes', () => {
      expect(formatDuration(1830)).toBe('30m 30s');
    });

    it('formats 59 minutes 59 seconds without hours', () => {
      expect(formatDuration(3599)).toBe('59m 59s');
    });
  });

  describe('hours, minutes, and seconds', () => {
    it('formats exactly 1 hour', () => {
      expect(formatDuration(3600)).toBe('1h 0m 0s');
    });

    it('formats 1 hour with minutes and seconds', () => {
      expect(formatDuration(3661)).toBe('1h 1m 1s');
    });

    it('formats typical movie length', () => {
      // 2 hours 30 minutes
      expect(formatDuration(9000)).toBe('2h 30m 0s');
    });

    it('formats long duration', () => {
      // 10 hours 30 minutes 45 seconds
      expect(formatDuration(37845)).toBe('10h 30m 45s');
    });
  });

  describe('edge cases', () => {
    it('handles fractional seconds by flooring', () => {
      expect(formatDuration(45.9)).toBe('45s');
    });

    it('handles negative numbers (floors to 0 or negative)', () => {
      // This tests current behavior - may want to handle differently
      expect(formatDuration(-1)).toBe('-1s');
    });

    it('handles very large numbers', () => {
      // 100 hours
      expect(formatDuration(360000)).toBe('100h 0m 0s');
    });
  });
});
