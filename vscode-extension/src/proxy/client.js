"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchProxyConfig = fetchProxyConfig;
exports.isProxyReachable = isProxyReachable;
exports.getActiveTarget = getActiveTarget;
const config_1 = require("../utils/config");
async function fetchProxyConfig() {
    const host = (0, config_1.getProxyHost)();
    const port = (0, config_1.getProxyPort)();
    const url = `http://${host}:${port}/api/query?type=config`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
        throw new Error(`Proxy returned ${res.status}: ${res.statusText}`);
    }
    return (await res.json());
}
async function isProxyReachable() {
    try {
        await fetchProxyConfig();
        return true;
    }
    catch {
        return false;
    }
}
function getActiveTarget(config, channelId) {
    const channel = config.channels.find((c) => c.id === channelId);
    const targetId = channel?.activeTarget ?? config.activeTarget;
    return config.targets.find((t) => t.id === targetId);
}
