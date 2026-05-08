import { findByProps, findByName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

// Modules
const UserStore = findByProps("getUser", "getUsers");
const UserFetcher = findByProps("fetchUser");
const FluxDispatcher = findByProps("dispatch", "subscribe");

const pending = new Set();

async function fetchUser(id: string) {
    if (!id || pending.has(id) || UserStore.getUser(id)) return;
    pending.add(id);

    try {
        // Try internal fetcher
        if (UserFetcher?.fetchUser) {
            await UserFetcher.fetchUser(id);
        } else {
            // Manual fallback if fetcher is missing
            const token = findByProps("getToken")?.getToken?.();
            if (!token) return;
            
            const res = await fetch(`https://discord.com{id}`, {
                headers: { Authorization: token }
            });
            if (res.ok) {
                const user = await res.json();
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            }
        }
    } catch (e) {
        logger.error(`[ValidUserFix] Fetch failed for ${id}`);
    }
}

let unpatch: () => void;

export default {
    onLoad() {
        // We look for 'UserMention' which is the component that handles <@id>
        const UserMention = findByName("UserMention", false) || findByProps("UserMentionNode");

        if (!UserMention) {
            return logger.error("[ValidUserFix] Could not find Mention Component");
        }

        // Patch the 'default' export or the component itself
        const target = UserMention.default ? "default" : "UserMentionNode";

        unpatch = before(target, UserMention, (args) => {
            const props = args[0];
            const userId = props?.userId || props?.id;

            if (userId && !UserStore.getUser(userId)) {
                fetchUser(userId);
            }
        });
        
        logger.info("[ValidUserFix] Plugin Started");
    },
    onUnload() {
        unpatch?.();
        pending.clear();
    }
}
