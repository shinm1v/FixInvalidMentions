import { FluxDispatcher, UserStore, UserFetcher } from "@metro/common";
import { findByProps } from "@metro/wrappers";
import { logger, safeFetch, invariant } from "@lib/utils";

const pending = new Set<string>();

async function resolve(id: string) {
    if (!id || pending.has(id) || UserStore.getUser(id)) return;

    pending.add(id);

    try {
        // Best method — Discord internally fetches + caches the user
        if (typeof UserFetcher?.fetchProfile === "function") {
            await UserFetcher.fetchProfile(id);
        } else if (typeof UserFetcher?.fetchUser === "function") {
            await UserFetcher.fetchUser(id);
        } else {
            // Fallback manual request
            const token = findByProps("getToken")?.getToken?.();

            if (!token) {
                logger.warn(`[ValidUserFix] Missing token for ${id}`);
                return;
            }

            const res = await safeFetch(
                `https://discord.com/api/v9/users/${id}`,
                {
                    headers: {
                        Authorization: token
                    }
                }
            );

            if (!res.ok) {
                logger.warn(
                    `[ValidUserFix] Failed to fetch ${id}: ${res.status}`
                );
                return;
            }

            const user = await res.json();

            FluxDispatcher.dispatch({
                type: "USER_UPDATE",
                user
            });
        }

        logger.info(`[ValidUserFix] Resolved user ${id}`);
    } catch (e) {
        logger.error(`[ValidUserFix] Failed resolving ${id}:`, e);
    } finally {
        // cooldown to prevent API spam
        setTimeout(() => pending.delete(id), 15000);
    }
}

function extractMentions(content: string): string[] {
    const matches = content.match(/<@!?(\d+)>/g);
    if (!matches) return [];

    return matches.map(m => m.replace(/[<@!>]/g, ""));
}

function handleEvent(event: any) {
    try {
        const messages =
            event?.type === "MESSAGE_CREATE"
                ? [event.message]
                : event.messages;

        if (!Array.isArray(messages)) return;

        for (const msg of messages) {
            const content = msg?.content;

            if (typeof content !== "string") continue;
            if (!content.includes("<@")) continue;

            const ids = extractMentions(content);

            for (const id of ids) {
                if (!UserStore.getUser(id)) {
                    resolve(id);
                }
            }
        }
    } catch (e) {
        logger.error("[ValidUserFix] Event handler error:", e);
    }
}

export default {
    onLoad() {
        invariant(FluxDispatcher, "FluxDispatcher unavailable");

        FluxDispatcher.subscribe(
            "MESSAGE_CREATE",
            handleEvent
        );

        FluxDispatcher.subscribe(
            "LOAD_MESSAGES_SUCCESS",
            handleEvent
        );

        logger.info(
            "[ValidUserFix] Loaded and monitoring unresolved mentions."
        );
    },

    onUnload() {
        FluxDispatcher.unsubscribe(
            "MESSAGE_CREATE",
            handleEvent
        );

        FluxDispatcher.unsubscribe(
            "LOAD_MESSAGES_SUCCESS",
            handleEvent
        );

        pending.clear();

        logger.info("[ValidUserFix] Unloaded.");
    }
};
