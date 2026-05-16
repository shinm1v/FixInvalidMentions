import { findByProps } from "@revenge-mod/metro";
import { FluxDispatcher } from "@revenge-mod/modules/common";

const UserStore = findByProps("getUser", "getCurrentUser");
const RestAPI = findByProps("getAPIBaseURL", "get", "post");

async function resolveAndPatch(message: any) {
    const mentions: any[] = message.mentions ?? [];

    for (const mention of mentions) {
        const id = mention.id;

        // already cached with a real name
        if (UserStore?.getUser(id)?.username) continue;

        try {
            const res = await RestAPI.get({ url: `/users/${id}` });
            const user = res?.body;
            if (!user) continue;

            // patch the mention inside the message object directly
            mention.username = user.username;
            mention.discriminator = user.discriminator;
            mention.avatar = user.avatar;
            mention.global_name = user.global_name ?? user.username;

        } catch (e) {
            console.warn(`[ResolveMentions] fetch failed for ${id}:`, e);
        }
    }

    // force Discord to re-render the message with updated mention data
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: {
            ...message,
            mentions,
        },
        // Discord needs these to locate the message
        channelId: message.channel_id,
    });
}

export default {
    start() {
        this._onMessage = (payload: any) => {
            const msg = payload?.message;
            if (!msg) return;

            const hasUnknown = (msg.mentions ?? []).some(
                (u: any) => !u.username
            );
            if (hasUnknown) resolveAndPatch(msg);
        };

        this._onLoad = (payload: any) => {
            for (const msg of payload?.messages ?? []) {
                const hasUnknown = (msg.mentions ?? []).some(
                    (u: any) => !u.username
                );
                if (hasUnknown) resolveAndPatch(msg);
            }
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", this._onMessage);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this._onLoad);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this._onMessage);
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this._onLoad);
    },
};
