import { findByProps, findByName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

const UserStore = findByProps("getUser", "getUsers");
const FluxDispatcher = findByProps("dispatch", "subscribe");
const UserFetcher = findByProps("fetchUser") || findByProps("getUser", "fetchProfile");

// ---------------------------------------------------------------------------

const pendingFetches = new Set<string>();

async function resolveUser(userId: string) {
  if (!userId || pendingFetches.has(userId) || UserStore.getUser(userId)) return;

  pendingFetches.add(userId);

  try {
    // 1. Aggressive Profile Fetch (More reliable than fetchUser)
    if (typeof UserFetcher?.fetchProfile === "function") {
        await UserFetcher.fetchProfile(userId);
    } 
    // 2. Standard User Fetch
    else if (typeof UserFetcher?.fetchUser === "function") {
        await UserFetcher.fetchUser(userId);
    } 
    // 3. API Fallback with manual Dispatch
    else {
        const token = findByProps("getToken")?.getToken?.();
        if (!token) return;

        const res = await fetch(`https://discord.com{userId}`, {
            headers: { Authorization: token }
        });

        if (res.ok) {
            const user = await res.json();
            if (FluxDispatcher) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            }
        }
    }
  } catch (err) {
    logger.error(`[ValidUserFix] Failed to resolve ${userId}:`, err);
  } finally {
    // Keep in pending for 10s to prevent spamming 404s
    setTimeout(() => pendingFetches.delete(userId), 10000);
  }
}

// ---------------------------------------------------------------------------

const patches: Array<() => void> = [];

export default {
  onLoad() {
    // Modern Discord Mobile component for <@id> mentions
    const MentionModule = findByName("UserMention", false) || findByProps("UserMentionNode");

    if (!MentionModule) {
      logger.error("[ValidUserFix] MentionModule not found.");
      return;
    }

    // Patch 'default' for functional components or 'UserMentionNode' for class-based ones
    const patchTarget = MentionModule.default ? "default" : "UserMentionNode";

    const unpatch = before(patchTarget, MentionModule, (args) => {
      try {
        const props = args[0];
        const userId = props?.userId || props?.id;

        if (userId && !UserStore.getUser(userId)) {
          resolveUser(String(userId));
        }
      } catch (err) {
          // Silent fail to prevent crash loops
      }
    });

    patches.push(unpatch);
    logger.info("[ValidUserFix] Plugin Loaded.");
  },

  onUnload() {
    for (const unpatch of patches) unpatch();
    patches.length = 0;
    pendingFetches.clear();
    logger.info("[ValidUserFix] Plugin Unloaded.");
  },
};
