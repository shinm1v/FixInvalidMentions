import { FluxDispatcher, UserStore, UserFetcher } from "@metro/common";
import { findByProps } from "@metro/wrappers";
import { logger, safeFetch, invariant } from "@lib/utils";

const pending = new Set<string>();

async function resolve(id: string) {
    // Accessing UserStore (Lazy Proxy) triggers its internal factory automatically
    if (!id || pending.has(id) || UserStore.getUser(id)) return;

    pending.add(id);

    try {
        // fetchProfile is the "Gold Standard" for fixing @unknown-user
        if (UserFetcher.fetchProfile) {
            await UserFetcher.fetchProfile(id);
        } else if (UserFetcher.fetchUser) {
            await UserFetcher.fetchUser(id);
        } else {
            // Native API fallback using the mod's internal safeFetch utility
            const token = findByProps("getToken")?.getToken?.();

            if (token) {
                await safeFetch(`https://discord.com/api/v9/users/${id}`, {
                    headers: { Authorization: token }
                });
            }
        }
    } catch (e) {
        logger.error(`[ValidUserFix] Failed to resolve ${id}:`, e);
    } finally {
        // 15s cooldown to prevent API spamming
        setTimeout(() => pending.delete(id), 15000);
    }
}

const handleEvent = (event: any) => {
    const messages =
        event.type === "MESSAGE_CREATE"
            ? [event.message]
            : event.messages;

    if (!messages) return;

    for (const msg of messages) {
        const content = msg?.content;

        if (typeof content === "string" && content.includes("<@")) {
            const matches = content.match(/<@!?(\d+)>/g);

            matches?.forEach(m =>
                resolve(m.replace(/[<@!>]/g, ""))
            );
        }
    }
};

export default {
    onLoad() {
        invariant(FluxDispatcher, "FluxDispatcher must be available");

        // Subscribe to Dispatcher events for high-speed mention detection
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleEvent);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", handleEvent);

        logger.info("[ValidUserFix] Monitoring dispatcher for unresolved mentions.");
    },

    onUnload() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleEvent);
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", handleEvent);

        pending.clear();
    }
};
