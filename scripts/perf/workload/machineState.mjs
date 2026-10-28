import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ROOT } from './cli.mjs';

export const CPU_COUNT = Number(run('nproc', [], '4') ?? 4);

// ── Machine state and benchmark validity ─────────────────────────────────────
// Wall-clock numbers from a contended host are not evidence. Every workload
// result carries the state captured around it, and a run whose state fails the
// thresholds below is classified rather than silently accepted.

function readProc(path, fallback = null) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function loadAverages() {
  const raw = readProc('/proc/loadavg');
  if (!raw) return [NaN, NaN, NaN];
  const parts = raw.split(/\s+/).map(Number);
  return [parts[0] ?? NaN, parts[1] ?? NaN, parts[2] ?? NaN];
}

function thermalMaxC() {
  try {
    const zones = execFileSync('sh', ['-c', 'ls /sys/class/thermal/thermal_zone*'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    let max = Number.NEGATIVE_INFINITY;
    for (const zone of zones) {
      const temp = readProc(`${zone}/temp`);
      if (temp && !Number.isNaN(Number(temp))) {
        // Most drivers report milli-degrees; some report degrees.
        const milli = Number(temp) > 1000;
        max = Math.max(max, milli ? Number(temp) / 1000 : Number(temp));
      }
    }
    return Number.isFinite(max) ? max : NaN;
  } catch {
    return NaN;
  }
}

function psiAvg10(resource) {
  const raw = readProc(`/proc/pressure/${resource}`);
  const value = raw?.match(/^some\s+.*?avg10=([\d.]+)/m)?.[1];
  return value === undefined ? null : Number(value);
}

function cpuFrequency() {
  const current = Number(readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'NaN'));
  const maximum = Number(readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq', 'NaN'));
  return {
    currentKHz: Number.isFinite(current) ? current : null,
    maxKHz: Number.isFinite(maximum) ? maximum : null,
    fractionOfMaximum:
      Number.isFinite(current) && Number.isFinite(maximum) && maximum > 0
        ? current / maximum
        : null,
  };
}

/** Other processes touching this repo or running repo-adjacent tooling. */
function backgroundActivity(myPids) {
  try {
    const lines = execFileSync('sh', ['-c', 'ps -eo pid=,ppid=,args='], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    const processes = lines
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        return match ? { pid: match[1], parent: match[2], args: match[3] } : null;
      })
      .filter(Boolean);
    const mine = new Set(myPids.filter(Number.isFinite).map(String));
    let changed = true;
    while (changed) {
      changed = false;
      for (const process of processes) {
        if (mine.has(process.parent) && !mine.has(process.pid)) {
          mine.add(process.pid);
          changed = true;
        }
      }
    }
    const suspicious =
      /(vitest|tsx |ts-node|esbuild|tsc |vite|webpack|next dev|madge|varve-desktop|chromium|chrome|WebKitWebProcess)/i;
    const hits = [];
    for (const process of processes) {
      if (mine.has(process.pid)) continue;
      const rest = process.args;
      if (!rest.includes('Varve') && !suspicious.test(rest)) continue;
      if (rest.includes('grep') || rest.includes('run-production-workload')) continue;
      hits.push(rest.trim().slice(0, 90));
    }
    return hits;
  } catch {
    return null;
  }
}

export function captureMachineState(myPids = []) {
  const [load1, load5, load15] = loadAverages();
  const memAvailableKb = Number(
    readProc('/proc/meminfo')?.match(/MemAvailable:\s+(\d+)/)?.[1] ?? NaN,
  );
  const thermal = thermalMaxC();
  const activity = backgroundActivity(myPids);
  const memoryPressure10 = psiAvg10('memory');
  const cpuPressure10 = psiAvg10('cpu');
  const memLow = Number.isFinite(memAvailableKb) && memAvailableKb < 1024 * 1024;
  const frequency = cpuFrequency();
  return {
    load1,
    load5,
    load15,
    cpuCount: CPU_COUNT,
    memAvailableKb: Number.isFinite(memAvailableKb) ? memAvailableKb : null,
    thermalMaxC: Number.isFinite(thermal) ? thermal : null,
    cpuPressureAvg10: Number.isFinite(cpuPressure10) ? cpuPressure10 : null,
    memoryPressureAvg10: Number.isFinite(memoryPressure10) ? memoryPressure10 : null,
    memoryPressure: memLow || (Number.isFinite(memoryPressure10) && memoryPressure10 > 1),
    cpuFrequency: frequency,
    governor: readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'unknown'),
    backgroundActivity: activity,
  };
}

export function run(cmd, cmdArgs, fallback = null) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return fallback;
  }
}
