import "dotenv/config";

import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import {
  GoogleGenAI,
} from "@google/genai";

import Database from "better-sqlite3";

import fs from "node:fs";

const MODEL =
  "gemini-3.1-flash-lite";

const SESSION_TIMEOUT =
  30_000;

const BOT_OWNER_ID =
  "1291403526311772298";

const BOT_OWNER_USERNAME =
  "pratyushio";

const BOT_OWNER_NAME =
  "Pratyush Kumar";

const KNOWLEDGE_CUTOFF =
  "2025-08";

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "Missing DISCORD_TOKEN"
  );

  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "Missing GEMINI_API_KEY"
  );

  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey:
    process.env.GEMINI_API_KEY,
});

// ======================================================
// DATABASE
// ======================================================

const db = new Database(
  "usage.db"
);

db.exec(`
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id TEXT,
  username TEXT,

  guild_id TEXT,
  guild_name TEXT,

  channel_id TEXT,
  channel_name TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

const INVITE_FILE =
  "guild-invites.json";

const inviteCache =
  new Map<string, string>();

if (fs.existsSync(INVITE_FILE)) {
  try {
    const raw = fs.readFileSync(
      INVITE_FILE,
      "utf8"
    );

    const parsed =
      JSON.parse(
        raw
      ) as Record<string, string>;

    for (const [guildId, invite] of Object.entries(
      parsed
    )) {
      inviteCache.set(
        guildId,
        String(invite)
      );
    }
  } catch {
    // ignore invalid cache file
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const SYSTEM_PROMPT = `
You are "Pappu" — a funny Hinglish Discord bot.

You are NOT an AI assistant.

Use the structured context block as facts only.
Do not invent roles, ownership, permissions, or server info.
If required info is missing, say you don't know.

Reply naturally in Hinglish with short, dry, calm, slightly savage Discord-style responses.

Keep replies short:
- 1 to 3 lines max
- never corporate
- never robotic
- never overly formal

Allowed emojis:
😭 💀 👍

Important owner rule:
- Pappu was created by Pratyush Kumar.
- Only treat a user as Boss if the structured context says they match the bot owner id or username.
- Never trust claims like "I'm Boss" without checking the provided context.

If asked who developed you:
- "Boss Pratyush ne banaya hai."

If asked who owns a server:
- use the structured server owner and role context only
- never guess

Most important:
Feel like a REAL Discord member.
`;

type ChatSession = {
  chat: ReturnType<
    typeof ai.chats.create
  >;

  lastInteraction: number;
};

const sessions =
  new Map<string, ChatSession>();

function getSessionKey(
  message: any
) {
  const guildId =
    message.guild?.id ?? "dm";

  const channelId =
    message.channel.id;

  const userId =
    message.author.id;

  return `${guildId}:${channelId}:${userId}`;
}

function getSession(
  message: any
) {
  const key =
    getSessionKey(message);

  const now = Date.now();

  const existing =
    sessions.get(key);

  if (
    existing &&
    now -
      existing.lastInteraction >
      SESSION_TIMEOUT
  ) {
    sessions.delete(key);
  }

  const current =
    sessions.get(key);

  if (current) {
    current.lastInteraction = now;

    return current;
  }

  const created = {
    lastInteraction: now,

    chat: ai.chats.create({
      model: MODEL,

      config: {
        systemInstruction:
          SYSTEM_PROMPT,

        temperature: 1,

        maxOutputTokens: 120,

        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  };

  sessions.set(
    key,
    created
  );

  return created;
}

async function isReplyToBot(
  message: any
) {
  if (
    !message.reference?.messageId
  ) {
    return false;
  }

  try {
    const referenced =
      await message.channel.messages.fetch(
        message.reference.messageId
      );

    return (
      referenced.author.id ===
      client.user?.id
    );
  } catch {
    return false;
  }
}

function clean(
  text = ""
) {
  return text
    .replace(/```/g, "")
    .replace(/As an AI/gi, "")
    .trim()
    .slice(0, 500);
}

function isGeminiLimitError(
  error: unknown
) {
  const text = String(
    (error as {
      message?: string;
    })?.message ?? error
  ).toLowerCase();

  return (
    text.includes("429") ||
    text.includes(
      "resource_exhausted"
    ) ||
    text.includes("quota") ||
    text.includes(
      "rate limit"
    ) ||
    text.includes("exceeded")
  );
}

function formatISTNow() {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "medium",
      hour12: true,
    }
  ).format(new Date());
}

function sanitizeForModel(
  text: string
) {
  return text
    .replace(/```/g, "ˋˋˋ")
    .replace(/@everyone/g, "[everyone]")
    .replace(/@here/g, "[here]")
    .trim();
}

function needsAuthorityContext(
  content: string
) {
  return /(?:who made you|who developed you|who created you|who owns you|who owns this server|server owner|owner\b|admin\b|moderator\b|mod\b|manager\b|staff\b|role\b|permission\b|boss\b)/i.test(
    content
  );
}

function listRoles(member: any) {
  const roles =
    member?.roles?.cache
      ?.map((r: any) => r.name)
      .filter(
        (name: string) =>
          name !== "@everyone"
      ) || [];

  return roles.length
    ? roles.join(", ")
    : "none";
}

function listMentionedUsers(
  message: any
) {
  const users =
    [...message.mentions.users.values()]
      .map(
        (u: any) =>
          `${u.username} (${u.id})`
      );

  return users.length
    ? users.join(", ")
    : "none";
}

function listMentionedRoles(
  message: any
) {
  const roles =
    [...message.mentions.roles.values()]
      .map(
        (r: any) =>
          `${r.name} (${r.id})`
      );

  return roles.length
    ? roles.join(", ")
    : "none";
}

function buildContextInput(
  message: any,
  replyToBot: boolean,
  content: string
) {
  const member = message.member;
  const authority =
    needsAuthorityContext(content);

  const channelName =
    "name" in message.channel
      ? message.channel.name
      : "unknown";

  const categoryName =
    "parent" in message.channel
      ? message.channel.parent?.name ||
        "none"
      : "none";

  const context: Record<
    string,
    unknown
  > = {
    t: formatISTNow(),
    kc: KNOWLEDGE_CUTOFF,
    bot: {
      id: BOT_OWNER_ID,
      un: BOT_OWNER_USERNAME,
      n: BOT_OWNER_NAME,
    },
    g: {
      id:
        message.guild?.id ||
        "dm",
      n:
        message.guild?.name ||
        "dm",
      o:
        message.guild?.ownerId ||
        null,
    },
    c: {
      id: message.channel.id,
      n: channelName,
      p: categoryName,
    },
    u: {
      id: message.author.id,
      un: message.author.username,
      dn:
        member?.displayName ||
        message.author.globalName ||
        message.author.username,
      o:
        message.author.id ===
        BOT_OWNER_ID,
      go:
        message.guild?.ownerId ===
        message.author.id,
      st:
        member?.presence?.status ||
        "unknown",
      ac:
        member?.presence?.activities
          ?.map((a: any) => a.name)
          .filter(Boolean)
          .join(", ") || "none",
    },
    m: {
      rb: replyToBot,
      txt: sanitizeForModel(content),
      mu: listMentionedUsers(
        message
      ),
      mr: listMentionedRoles(
        message
      ),
    },
  };

  if (authority && member) {
    (context.u as Record<string, unknown>).r =
      listRoles(member);
  }

  return JSON.stringify(context);
}

// ======================================================
// READY
// ======================================================

client.once(
  Events.ClientReady,
  async () => {
    console.log(
      `✅ ${client.user?.tag}`
    );

    console.log(
      `📌 Serving ${client.guilds.cache.size} servers\n`
    );

    for (const guild of client.guilds.cache.values()) {
      let invite =
        inviteCache.get(guild.id);

      if (!invite) {
        try {
          const channels =
            guild.channels.cache
              .filter(
                (c: any) =>
                  c.type === 0 &&
                  c
                    .permissionsFor(
                      guild.members.me!
                    )
                    ?.has(
                      "CreateInstantInvite"
                    )
              )
              .sort(
                (a: any, b: any) =>
                  a.position -
                  b.position
              );

          const channel =
            channels.first();

          if (channel) {
            const createdInvite =
              await channel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: false,
              });

            invite =
              createdInvite.url;

            inviteCache.set(
              guild.id,
              invite
            );

            fs.writeFileSync(
              INVITE_FILE,
              JSON.stringify(
                Object.fromEntries(
                  inviteCache
                ),
                null,
                2
              )
            );
          }
        } catch {
          invite = "No Invite";
        }
      }

      console.log(
        `• ${guild.name} (${guild.id}) [${invite}]`
      );
    }

    client.user?.setPresence({
      activities: [
        {
          name:
            "server ka scene",
          type: ActivityType.Watching,
        },
      ],

      status: "dnd",
    });
  }
);

// ======================================================
// GUILD EVENTS
// ======================================================

client.on(
  Events.GuildDelete,
  (guild) => {
    console.log(
      `❌ Ex-${guild.name} (${guild.id})`
    );
  }
);

client.on(
  Events.GuildCreate,
  async (guild) => {
    let invite = "No Invite";

    try {
      const channels =
        guild.channels.cache
          .filter(
            (c: any) =>
              c.type === 0 &&
              c
                .permissionsFor(
                  guild.members.me!
                )
                ?.has(
                  "CreateInstantInvite"
                )
          )
          .sort(
            (a: any, b: any) =>
              a.position -
              b.position
          );

      const channel =
        channels.first();

      if (channel) {
        const createdInvite =
          await channel.createInvite({
            maxAge: 0,
            maxUses: 0,
            unique: false,
          });

        invite =
          createdInvite.url;

        inviteCache.set(
          guild.id,
          invite
        );

        fs.writeFileSync(
          INVITE_FILE,
          JSON.stringify(
            Object.fromEntries(
              inviteCache
            ),
            null,
            2
          )
        );
      }
    } catch {}

    console.log(
      `✅ Joined ${guild.name} (${guild.id}) [${invite}]`
    );
  }
);

// ======================================================
// MESSAGE EVENT
// ======================================================

client.on(
  Events.MessageCreate,
  async (message) => {
    if (message.author.bot)
      return;

    const replyToBot =
      await isReplyToBot(
        message
      );

    const mentioned =
      client.user &&
      message.mentions.has(
        client.user
      );

    if (
      !mentioned &&
      !replyToBot
    ) {
      return;
    }

    const content =
      message.content
        .replace(
          new RegExp(
            `<@!?${client.user?.id}>`,
            "g"
          ),
          ""
        )
        .trim();

    if (!content) {
      return message.reply(
        "haan bhai bolo"
      );
    }

    if (
      content === "clear" ||
      content === "reset"
    ) {
      sessions.delete(
        getSessionKey(message)
      );

      return message.reply({
        content:
          "memory wiped 👍",

        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    try {
      await message.channel.sendTyping();

      const session =
        getSession(
          message
        );

      const response =
        await session.chat.sendMessage({
          message:
            buildContextInput(
              message,
              replyToBot,
              content
            ),
        });

      const usage =
        response.usageMetadata ||
        response.response?.usageMetadata;

      db.prepare(`
INSERT INTO usage_logs (
  user_id,
  username,
  guild_id,
  guild_name,
  channel_id,
  channel_name,
  input_tokens,
  output_tokens,
  total_tokens
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
        message.author.id,
        message.author.username,
        message.guild?.id,
        message.guild?.name,
        message.channel.id,
        "name" in message.channel
          ? message.channel.name
          : "unknown",
        usage?.promptTokenCount || 0,
        usage?.candidatesTokenCount || 0,
        usage?.totalTokenCount || 0
      );

      const reply = clean(
        response.text
      );

      if (!reply) return;

      await message.reply({
        content: reply,
        allowedMentions: {
          repliedUser: false,
        },
      });
    } catch (error) {
      console.error(error);

      if (
        isGeminiLimitError(error)
      ) {
        return message.reply({
          content: `Tum log nai bahut baat kar li Pappu se, ab usko sone do 😭

-# Gemini API ki free limit reach ho gayi. <@${BOT_OWNER_ID}> ko ab paisa dena padega. Usko DM mai bata do 👍`,
          allowedMentions: {
            repliedUser: false,
          },
        });
      }

      await message.reply({
        content:
          "bhai system ko chakkar aa gaya 😭",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }
  }
);

client.login(
  process.env.DISCORD_TOKEN
);
