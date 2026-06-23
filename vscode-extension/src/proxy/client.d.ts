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
export declare function fetchProxyConfig(): Promise<ProxyConfig>;
export declare function isProxyReachable(): Promise<boolean>;
export declare function getActiveTarget(config: ProxyConfig, channelId: string): ProxyTarget | undefined;
