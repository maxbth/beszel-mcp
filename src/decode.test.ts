import {test, expect} from 'bun:test';
import {
  decodeEnum,
  decodeSystemInfo,
  decodeSystemStats,
  decodeContainerStat,
  formatUptime,
  round,
  OS_LABELS,
  SERVICE_STATUS_LABELS,
  CONTAINER_HEALTH_LABELS,
} from './decode';

test('decodeEnum maps in-range values to labels', () => {
  expect(decodeEnum(OS_LABELS, 0)).toBe('Linux');
  expect(decodeEnum(OS_LABELS, 2)).toBe('Windows');
  expect(decodeEnum(SERVICE_STATUS_LABELS, 2)).toBe('Failed');
  expect(decodeEnum(CONTAINER_HEALTH_LABELS, 3)).toBe('Unhealthy');
});

test('decodeEnum returns undefined for out-of-range and missing values', () => {
  expect(decodeEnum(OS_LABELS, 99)).toBeUndefined();
  expect(decodeEnum(OS_LABELS, -1)).toBeUndefined();
  expect(decodeEnum(OS_LABELS, undefined)).toBeUndefined();
});

test('formatUptime renders days, hours and minutes', () => {
  expect(formatUptime(90)).toBe('1m');
  expect(formatUptime(3_660)).toBe('1h 1m');
  expect(formatUptime(90_061)).toBe('1d 1h 1m');
  expect(formatUptime(undefined)).toBeUndefined();
});

test('round trims floating point noise', () => {
  expect(round(12.345_678, 2)).toBe(12.35);
  expect(round(12.345_678)).toBe(12.3);
  expect(round(undefined)).toBeUndefined();
});

test('decodeSystemInfo expands abbreviated keys and enums', () => {
  const decoded = decodeSystemInfo({
    h: 'nas',
    k: '6.1.0',
    cpu: 12.5,
    c: 4,
    t: 8,
    m: 'Intel N100',
    la: [0.5, 0.4, 0.3],
    u: 90_061,
    mp: 61.2,
    dp: 44.4,
    bb: 13_107_200,
    v: '0.9.1',
    os: 0,
    ct: 2,
    g: 33,
    dt: 41.5,
    bat: [87, 4],
    sv: [120, 2],
    efs: {'/mnt/tank': 71.5},
  });
  expect(decoded.hostname).toBe('nas');
  expect(decoded.kernel).toBe('6.1.0');
  expect(decoded.cpuPercent).toBe(12.5);
  expect(decoded.cores).toBe(4);
  expect(decoded.threads).toBe(8);
  expect(decoded.cpuModel).toBe('Intel N100');
  expect(decoded.loadAverage).toEqual([0.5, 0.4, 0.3]);
  expect(decoded.uptime).toBe('1d 1h 1m');
  expect(decoded.memoryPercent).toBe(61.2);
  expect(decoded.diskPercent).toBe(44.4);
  // `bb` is sent+recv BYTES per second (`agent/system.go:259`): 13107200 B/s = 12.5 MB/s.
  expect(decoded.bandwidthMbPerSec).toBe(12.5);
  expect(decoded.agentVersion).toBe('0.9.1');
  expect(decoded.os).toBe('Linux');
  expect(decoded.connectionType).toBe('WebSocket');
  expect(decoded.gpuPercent).toBe(33);
  expect(decoded.temperatureC).toBe(41.5);
  expect(decoded.battery).toEqual({
    percent: 87,
    state: 'Discharging'
  });
  expect(decoded.services).toEqual({
    total: 120,
    failed: 2
  });
  expect(decoded.extraFilesystemPercent).toEqual({'/mnt/tank': 71.5});
});

test('decodeSystemInfo omits absent optional fields rather than emitting undefined keys', () => {
  const decoded = decodeSystemInfo({
    h: 'box',
    cpu: 1,
    c: 2,
    m: 'CPU',
    u: 60,
    mp: 10,
    dp: 20,
    bb: 0,
    v: '1.0.0'
  });
  expect('battery' in decoded).toBe(false);
  expect('gpuPercent' in decoded).toBe(false);
  expect('services' in decoded).toBe(false);
});

test('decodeSystemStats expands stats keys and the disk-io six-tuple', () => {
  const decoded = decodeSystemStats({
    cpu: 20,
    m: 16,
    mu: 8,
    mp: 50,
    mb: 2,
    s: 4,
    su: 1,
    d: 500,
    du: 250,
    dp: 50,
    dr: 1.5,
    dw: 2.5,
    // `b` is the live bandwidth pair in BYTES per second (`agent/network.go:231`):
    // 5 MiB/s up, 1.5 MiB/s down.
    b: [5_242_880, 1_572_864],
    la: [1, 2, 3],
    t: {cpu: 45.5},
    dios: [1, 2, 3, 4, 5, 6],
  });
  expect(decoded.cpuPercent).toBe(20);
  expect(decoded.memoryTotalGb).toBe(16);
  expect(decoded.memoryUsedGb).toBe(8);
  expect(decoded.memoryPercent).toBe(50);
  expect(decoded.memoryCacheGb).toBe(2);
  expect(decoded.swapTotalGb).toBe(4);
  expect(decoded.swapUsedGb).toBe(1);
  expect(decoded.diskTotalGb).toBe(500);
  expect(decoded.diskUsedGb).toBe(250);
  expect(decoded.diskPercent).toBe(50);
  expect(decoded.diskReadMbPerSec).toBe(1.5);
  expect(decoded.diskWriteMbPerSec).toBe(2.5);
  expect(decoded.networkSentMbPerSec).toBe(5);
  expect(decoded.networkReceivedMbPerSec).toBe(1.5);
  expect(decoded.loadAverage).toEqual([1, 2, 3]);
  expect(decoded.temperaturesC).toEqual({cpu: 45.5});
  expect(decoded.diskIo).toEqual({
    readTimePercent: 1,
    writeTimePercent: 2,
    utilizationPercent: 3,
    readAwaitMs: 4,
    writeAwaitMs: 5,
    weightedIoPercent: 6,
  });
});

test('decodeSystemStats decodes the gpu map', () => {
  const decoded = decodeSystemStats({
    cpu: 1,
    m: 1,
    mu: 1,
    mp: 1,
    mb: 0,
    s: 0,
    su: 0,
    d: 1,
    du: 1,
    dp: 1,
    dr: 0,
    dw: 0,
    g: {
      '0': {
        n: 'RTX 4090',
        u: 55,
        mu: 2_048,
        mt: 24_576,
        p: 210
      }
    },
  });
  expect(decoded.gpus).toEqual({
    '0': {
      name: 'RTX 4090',
      usagePercent: 55,
      memoryUsedMb: 2_048,
      memoryTotalMb: 24_576,
      powerWatts: 210
    },
  });
});

test('decodeContainerStat expands container keys', () => {
  // A container holding 512 MiB of RSS. `agent/docker.go:362` sends that as `m: 512` —
  // MEGABYTES, despite the frontend's `types.d.ts` labelling the field `(gb)`.
  // `b` (bytes/sec, `agent/docker.go:363`) wins over the deprecated `ns`/`nr` MB/s pair, so the
  // two carry deliberately irreconcilable values here: were the precedence inverted, this would
  // report 99 / 88 instead.
  expect(decodeContainerStat({
    n: 'caddy',
    c: 3.5,
    m: 512,
    b: [1_048_576, 2_097_152],
    ns: 99,
    nr: 88
  })).toEqual({
    name: 'caddy',
    cpuPercent: 3.5,
    memoryMb: 512,
    networkSentMbPerSec: 1,
    networkReceivedMbPerSec: 2,
  });
});

test('decodeContainerStat falls back to the deprecated ns/nr pair when b is absent', () => {
  const decoded = decodeContainerStat({
    n: 'caddy',
    c: 1,
    m: 64,
    ns: 0.25,
    nr: 0.5
  });
  expect(decoded.networkSentMbPerSec).toBe(0.25);
  expect(decoded.networkReceivedMbPerSec).toBe(0.5);
});

test('decodeSystemStats reads network from the b pair, not the dead ns/nr fields', () => {
  // The regression this guards: `agent/network.go` never assigns NetworkSent/NetworkRecv, and
  // `hub/systems/system.go:747-751` zeroes them, so a current hub sends `b` and no ns/nr at all.
  const decoded = decodeSystemStats({
    cpu: 5,
    m: 32,
    mu: 12,
    mp: 37.5,
    mb: 4,
    s: 0,
    su: 0,
    d: 900,
    du: 400,
    dp: 44.4,
    b: [1_048_576, 10_485_760]
  });
  expect(decoded.networkSentMbPerSec).toBe(1);
  expect(decoded.networkReceivedMbPerSec).toBe(10);
});

test('decodeSystemStats falls back to ns/nr for a pre-0.19 hub that still sends them', () => {
  const decoded = decodeSystemStats({
    cpu: 5,
    m: 32,
    mu: 12,
    mp: 37.5,
    mb: 4,
    s: 0,
    su: 0,
    d: 900,
    du: 400,
    dp: 44.4,
    ns: 0.5,
    nr: 1.5
  });
  expect(decoded.networkSentMbPerSec).toBe(0.5);
  expect(decoded.networkReceivedMbPerSec).toBe(1.5);
});
