import type { CommuteRequest, CompareResult } from '@pendular/engine/types';

export interface PlaceHit {
  label: string;
  type: 'stop' | 'address' | 'place';
  lat: number;
  lon: number;
  stopId?: string;
}

export async function searchPlaces(q: string, lang: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const res = await fetch(`/api/places?q=${encodeURIComponent(q)}&lang=${lang}`, { signal });
  if (!res.ok) throw new Error(`places ${res.status}`);
  return (await res.json()) as PlaceHit[];
}

export async function compareCommute(req: CommuteRequest, signal?: AbortSignal): Promise<CompareResult> {
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `compare ${res.status}`);
  }
  return (await res.json()) as CompareResult;
}
