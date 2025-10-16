import inspector from 'node:inspector';
import { writeFile } from 'node:fs/promises';

let cpuSession: inspector.Session | undefined;

async function post<T = void>(
  session: inspector.Session,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result as T);
      }
    });
  });
}

export async function startCpuProfiling(): Promise<void> {
  if (cpuSession) {
    return;
  }
  cpuSession = new inspector.Session();
  cpuSession.connect();
  await post(cpuSession, 'Profiler.enable');
  await post(cpuSession, 'Profiler.start');
}

export async function stopCpuProfiling(): Promise<inspector.Profiler.Profile | undefined> {
  if (!cpuSession) {
    return undefined;
  }
  const session = cpuSession;
  cpuSession = undefined;
  const result = await post<{ profile: inspector.Profiler.Profile }>(session, 'Profiler.stop');
  await post(session, 'Profiler.disable').catch(() => undefined);
  session.disconnect();
  return result.profile;
}

export async function writeCpuProfile(filePath: string): Promise<void> {
  const profile = await stopCpuProfiling();
  if (!profile) {
    return;
  }
  await writeFile(filePath, JSON.stringify(profile));
}

export async function captureCpuProfile(durationMs: number): Promise<inspector.Profiler.Profile> {
  const session = new inspector.Session();
  session.connect();
  await post(session, 'Profiler.enable');
  await post(session, 'Profiler.start');
  await new Promise((resolve) => setTimeout(resolve, Math.max(10, durationMs)));
  const result = await post<{ profile: inspector.Profiler.Profile }>(session, 'Profiler.stop');
  await post(session, 'Profiler.disable').catch(() => undefined);
  session.disconnect();
  return result.profile;
}

export async function writeHeapSnapshot(filePath: string): Promise<void> {
  const snapshot = await captureHeapSnapshot();
  await writeFile(filePath, snapshot);
}

export async function captureHeapSnapshot(): Promise<string> {
  const session = new inspector.Session();
  session.connect();
  await post(session, 'HeapProfiler.enable');
  const chunks: string[] = [];
  session.on('HeapProfiler.addHeapSnapshotChunk', (message) => {
    chunks.push(message.params.chunk);
  });
  await post(session, 'HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await post(session, 'HeapProfiler.disable').catch(() => undefined);
  session.disconnect();
  return chunks.join('');
}
