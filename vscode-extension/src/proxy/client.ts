import { getProxyHost, getProxyPort } from "../utils/config";

export interface ProxyConfig {
  activeTarget: string;
  targets: ProxyTarget[];
  channels: ProxyChannel[];
}

export interface ProxyTarget {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  bodyParams: Record<string, unknown>;
}

export interface ProxyChannel {
  id: string;
  name: string;
  activeTarget: string;
}

export async function fetchProxyConfig(): Promise<ProxyConfig> {
  const host = getProxyHost();
  const port = getProxyPort();
  const url = `http://${host}:${port}/api/query?type=config`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`Proxy returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as ProxyConfig;
}

export async function isProxyReachable(): Promise<boolean> {
  try {
    await fetchProxyConfig();
    return true;
  } catch {
    return false;
  }
}

export function getActiveTarget(
  config: ProxyConfig,
  channelId: string,
): ProxyTarget | undefined {
  const channel = config.channels.find((c) => c.id === channelId);
  const targetId = channel?.activeTarget ?? config.activeTarget;
  return config.targets.find((t) => t.id === targetId);
}
