import { findByProps, findByName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

const UserStore = findByProps("getUser", "getUsers");
const FluxDispatcher = findByProps("dispatch", "subscribe");
const UserFetcher = findByProps("fetchUser") || findByProps("getUser", "fetchProfile");

// Fallback for getting the Auth Token if internal fetchers fail
const getToken = () => findByProps("getToken")?.getToken?.();

const pendingFetches = new Set();

async function resolveUser(userId: string) {
  if (!userId || pendingFetches.has(userId) || UserStore.getUser(userId)) return;

  pendingFetches.add(userId);

  try {
    // 1. Try Discord's internal fetcher first (Cleanest way)
    if (UserFetcher?.fetchUser) {
      await UserFetcher.fetchUser(userId);
    } 
    // 2. Manual fallback if internal fetcher is missing
    else {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`https://discord.com{userId}`, {
        headers: { Authorization: token }
      });

      if (res.ok) {
        const user = await res.json();
        FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
      }
    }
  } catch (e) {
    logger.error(`[ValidUserFix] Failed for ${userId}`, e);
  } finally {
    // Keep it in pending for a bit to avoid spamming 404s
    setTimeout(() => pendingFetches.delete(userId), 10000);
  }
}

const patches = [];

export default {
  onLoad() {
    const MentionModule = findByProps("UserMentionNode") || findByName("UserMentionNode", false);
    if (!MentionModule) return logger.error("MentionModule not found");

    // Patch the component before it renders
    patches.push(before("default", MentionModule, (args) => {
      const id = args[0]?.userId || args[0]?.id;
      if (id) resolveUser(id);
    }));
  },
  onUnload() {
    patches.forEach(unpatch => unpatch());
    pendingFetches.clear();
  }
};
