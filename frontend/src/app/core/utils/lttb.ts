import { MetricHistoryPoint } from '../models/metric.model';

/**
 * Largest-Triangle-Three-Buckets (LTTB) Downsampling Algorithm
 *
 * Downsamples time-series data while preserving critical visual peaks,
 * valleys, and spikes (critical for real-time latency and error tracking).
 *
 * @param data Array of original data points
 * @param threshold Maximum number of points to retain (<= 300)
 */
export function downsampleLTTB(data: MetricHistoryPoint[], threshold: number): MetricHistoryPoint[] {
  if (threshold >= data.length || threshold <= 2) {
    return data;
  }

  const sampled: MetricHistoryPoint[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  // Always keep first point
  sampled.push(data[0]);

  let a = 0; // index of previously selected point

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate average point for bucket next to current bucket
    let avgX = 0;
    let avgP95 = 0;

    const avgBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
    const avgBucketLength = avgBucketEnd - avgBucketStart;

    if (avgBucketLength <= 0) {
      break;
    }

    for (let j = avgBucketStart; j < avgBucketEnd; j++) {
      avgX += data[j].ts;
      avgP95 += data[j].p95;
    }
    avgX /= avgBucketLength;
    avgP95 /= avgBucketLength;

    // Current bucket range
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);

    let maxArea = -1;
    let maxAreaPoint = data[bucketStart];

    // Find point in current bucket that creates maximum triangle area with previous point and next average point
    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (data[a].ts - avgX) * (data[j].p95 - data[a].p95) -
        (data[a].ts - data[j].ts) * (avgP95 - data[a].p95)
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[j];
        a = j;
      }
    }

    sampled.push(maxAreaPoint);
  }

  // Always keep last point
  if (data.length > 1) {
    sampled.push(data[data.length - 1]);
  }

  return sampled;
}

