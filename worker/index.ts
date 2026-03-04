import handler from "vinext/server/app-router-entry";
import { KVCacheHandler } from "vinext/cloudflare";
import { setCacheHandler } from "next/cache";

interface WorkerEnv {
    MY_KV_NAMESPACE?: KVNamespace;
    [key: string]: unknown;
}

const syncBindingsToProcessEnv = (env: WorkerEnv) => {
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
            process.env[key] = value;
            env[key] = value;
            continue;
        }

        if (typeof value === "number" || typeof value === "boolean") {
            process.env[key] = String(value);
            env[key] = String(value);
        }
    }
};

const worker = {
    async fetch(request: Request, env: WorkerEnv) {
        syncBindingsToProcessEnv(env);

        if (env.MY_KV_NAMESPACE) {
            setCacheHandler(new KVCacheHandler(env.MY_KV_NAMESPACE));
        }

        return handler.fetch(request);
    },
};

export default worker;
