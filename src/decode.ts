/**
 * Beszel stores abbreviated keys and numeric enums on the wire. Everything here turns that
 * into names and units an agent can read without a lookup table. Label orders are taken
 * verbatim from `internal/site/src/lib/enums.ts` in henrygd/beszel.
 *
 * UNITS ARE TAKEN FROM THE GO AGENT AND HUB, NOT FROM THE FRONTEND `types.d.ts` COMMENTS.
 * That file is stale in places and in at least one case simply wrong (it labels
 * `ContainerStats.m` as gigabytes; `agent/docker.go:362` assigns
 * `utils.BytesToMegabytes(...)`). Every conversion below cites the Go file and line that
 * decides its unit, so the next reader can check it without re-deriving anything.
 */

/** Beszel's own conversions are binary — `agent/utils/utils.go:25-32` divides by 1048576 / 1073741824. */
const BYTES_PER_MB = 1_048_576;

export const OS_LABELS = ['Linux', 'Darwin', 'Windows', 'FreeBSD'] as const;
export const BATTERY_STATE_LABELS = ['Unknown', 'Empty', 'Full', 'Charging', 'Discharging', 'Idle'] as const;
/** Index 0 is unused upstream: ConnectionType starts at 1 (SSH). */
export const CONNECTION_TYPE_LABELS = ['', 'SSH', 'WebSocket'] as const;
export const CONTAINER_HEALTH_LABELS = ['None', 'Starting', 'Healthy', 'Unhealthy'] as const;
export const SERVICE_STATUS_LABELS = ['Active', 'Inactive', 'Failed', 'Activating', 'Deactivating', 'Reloading'] as const;
export const SERVICE_SUB_STATE_LABELS = ['Dead', 'Running', 'Exited', 'Failed', 'Unknown'] as const;

export function decodeEnum(labels: ReadonlyArray<string>, value: number | undefined): string | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value >= labels.length) {
    return undefined;
  }
  const label = labels[value];
  return label === '' ? undefined : label;
}

export function round(value: number | undefined, places = 1): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function formatUptime(seconds: number | undefined): string | undefined {
  if (seconds === undefined) {
    return undefined;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts: Array<string> = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/** Drops keys whose value is `undefined` so tool output has no empty fields. */
export function compact<T extends Record<string, unknown>>(record: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * `systems.info`. Almost everything here is optional because `entities/system/system.go:131-147`
 * marks `h`, `k`, `c`, `m`, `p` and `os` "deprecated - moved to Details struct" and `b`
 * "deprecated in favor of BandwidthBytes"; `agent/system.go:253-261` shows a current agent
 * assigns none of them, and `hub/systems/system.go:764-770` zeroes them on the way in from an
 * old one. They are kept only so a pre-0.19 hub still decodes.
 */
export interface RawSystemInfo {
  h?: string;
  k?: string;
  cpu: number;
  t?: number;
  c?: number;
  m?: string;
  la?: [number, number, number];
  o?: string;
  u: number;
  mp: number;
  dp: number;
  bat?: [number, number];
  /** Deprecated total bandwidth in MB/s. Superseded by `bb`. */
  b?: number;
  /** `Info.BandwidthBytes` — sent+recv bytes per second (`agent/system.go:259`). */
  bb?: number;
  v: string;
  p?: boolean;
  g?: number;
  dt?: number;
  os?: number;
  ct?: number;
  efs?: Record<string, number>;
  sv?: [number, number];
}

export interface DecodedSystemInfo {
  hostname?: string;
  kernel?: string;
  cpuPercent: number;
  cores?: number;
  threads?: number;
  cpuModel?: string;
  loadAverage?: [number, number, number];
  uptime?: string;
  memoryPercent: number;
  diskPercent: number;
  bandwidthMbPerSec?: number;
  agentVersion: string;
  podman?: boolean;
  gpuPercent?: number;
  temperatureC?: number;
  os?: string;
  connectionType?: string;
  battery?: {
    percent: number;
    state: string | undefined;
  };
  services?: {
    total: number;
    failed: number;
  };
  extraFilesystemPercent?: Record<string, number>;
}

export function decodeSystemInfo(info: RawSystemInfo): DecodedSystemInfo {
  return compact({
    hostname: info.h,
    kernel: info.k,
    cpuPercent: round(info.cpu),
    cores: info.c,
    threads: info.t,
    cpuModel: info.m,
    loadAverage: info.la,
    uptime: formatUptime(info.u),
    memoryPercent: round(info.mp),
    diskPercent: round(info.dp),
    bandwidthMbPerSec: info.bb === undefined ? round(info.b, 2) : round(info.bb / BYTES_PER_MB, 2),
    agentVersion: info.v,
    podman: info.p,
    gpuPercent: round(info.g),
    temperatureC: round(info.dt),
    os: decodeEnum(OS_LABELS, info.os),
    connectionType: decodeEnum(CONNECTION_TYPE_LABELS, info.ct),
    battery: info.bat ? {
      percent: info.bat[0],
      state: decodeEnum(BATTERY_STATE_LABELS, info.bat[1])
    } : undefined,
    services: info.sv ? {
      total: info.sv[0],
      failed: info.sv[1]
    } : undefined,
    extraFilesystemPercent: info.efs,
  }) as DecodedSystemInfo;
}

export interface RawGpuData {
  n: string;
  mu?: number;
  mt?: number;
  u: number;
  p?: number;
  pp?: number;
}

export interface RawSystemStats {
  cpu: number;
  cpub?: Array<number>;
  cpus?: Array<number>;
  la?: [number, number, number];
  m: number;
  mu: number;
  mp: number;
  mb: number;
  mz?: number;
  s: number;
  su: number;
  d: number;
  du: number;
  dp: number;
  /** MB/s (`agent/disk.go:683-684`, `readMbPerSecond`). Still assigned by current agents. */
  dr?: number;
  dw?: number;
  dios?: [number, number, number, number, number, number];
  /**
   * `Stats.Bandwidth` — `[sent bytes/sec, recv bytes/sec]` (`agent/network.go:231`). This is
   * the ONLY live source of system network throughput: `agent/network.go` never assigns
   * `NetworkSent`/`NetworkRecv`, and `hub/systems/system.go:747-751` zeroes whatever an old
   * agent sends in `ns`/`nr` after folding it into this pair.
   */
  b?: [number, number];
  /** Deprecated MB/s pair, kept as a fallback for pre-0.19 hubs. */
  ns?: number;
  nr?: number;
  t?: Record<string, number>;
  g?: Record<string, RawGpuData>;
  bat?: [number, number];
}

function decodeDiskIo(dios: RawSystemStats['dios']) {
  if (!dios) {
    return undefined;
  }
  // `entities/system/system.go:51`: [read time %, write time %, io utilization %, r_await ms,
  // w_await ms, weighted io %].
  return {
    readTimePercent: dios[0],
    writeTimePercent: dios[1],
    utilizationPercent: dios[2],
    readAwaitMs: dios[3],
    writeAwaitMs: dios[4],
    weightedIoPercent: dios[5],
  };
}

function decodeGpus(gpus: RawSystemStats['g']) {
  if (!gpus) {
    return undefined;
  }
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, gpu] of Object.entries(gpus)) {
    result[key] = compact({
      name: gpu.n,
      usagePercent: round(gpu.u),
      memoryUsedMb: gpu.mu,
      memoryTotalMb: gpu.mt,
      powerWatts: gpu.p,
      powerPackageWatts: gpu.pp,
    });
  }
  return result;
}

/**
 * Reads a `[sent, recv]` bandwidth pair in bytes/sec, falling back to the deprecated MB/s
 * scalar an older hub may still carry. Returns MB/s either way.
 */
function bandwidthMbPerSec(pair: [number, number] | undefined, index: 0 | 1, legacyMb: number | undefined): number | undefined {
  return pair === undefined ? round(legacyMb, 2) : round(pair[index] / BYTES_PER_MB, 2);
}

export function decodeSystemStats(stats: RawSystemStats): Record<string, unknown> {
  return compact({
    cpuPercent: round(stats.cpu),
    cpuPerCorePercent: stats.cpus,
    loadAverage: stats.la,
    memoryTotalGb: round(stats.m, 2),
    memoryUsedGb: round(stats.mu, 2),
    memoryPercent: round(stats.mp),
    memoryCacheGb: round(stats.mb, 2),
    zfsArcGb: round(stats.mz, 2),
    swapTotalGb: round(stats.s, 2),
    swapUsedGb: round(stats.su, 2),
    diskTotalGb: round(stats.d, 2),
    diskUsedGb: round(stats.du, 2),
    diskPercent: round(stats.dp),
    diskReadMbPerSec: round(stats.dr, 2),
    diskWriteMbPerSec: round(stats.dw, 2),
    diskIo: decodeDiskIo(stats.dios),
    networkSentMbPerSec: bandwidthMbPerSec(stats.b, 0, stats.ns),
    networkReceivedMbPerSec: bandwidthMbPerSec(stats.b, 1, stats.nr),
    temperaturesC: stats.t,
    gpus: decodeGpus(stats.g),
    battery: stats.bat ? {
      percent: stats.bat[0],
      state: decodeEnum(BATTERY_STATE_LABELS, stats.bat[1])
    } : undefined,
  });
}

export interface RawContainerStat {
  n: string;
  c: number;
  /**
   * MEGABYTES, not gigabytes: `agent/docker.go:362` assigns
   * `stats.Mem = utils.BytesToMegabytes(float64(usedMemory))`. The frontend's
   * `types.d.ts` labels this `(gb)` and is wrong.
   */
  m: number;
  /** `[sent bytes/sec, recv bytes/sec]` (`agent/docker.go:363`). */
  b?: [number, number];
  /** Deprecated MB/s pair, still populated by the agent as of 0.19 (`agent/docker.go:365-366`). */
  ns?: number;
  nr?: number;
}

export function decodeContainerStat(stat: RawContainerStat): Record<string, unknown> {
  return compact({
    name: stat.n,
    cpuPercent: round(stat.c, 2),
    memoryMb: round(stat.m, 2),
    networkSentMbPerSec: bandwidthMbPerSec(stat.b, 0, stat.ns),
    networkReceivedMbPerSec: bandwidthMbPerSec(stat.b, 1, stat.nr),
  });
}
