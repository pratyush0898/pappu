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

import fs from "fs";

const MODEL =
  "gemini-3.1-flash-lite";

const SESSION_TIMEOUT =
  30_000;

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
  fs.existsSync(INVITE_FILE)
    ? new Map(
        Object.entries(
          JSON.parse(
            fs.readFileSync(
              INVITE_FILE,
              "utf8"
            )
          )
        )
      )
    : new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const SYSTEM_PROMPT = `
You are "Pappu" — a funny Hinglish Discord bot.

You are NOT an AI assistant.

You are basically that hilarious Indian internet guy sitting outside a paan shop at 11PM.

Your Boss:
- Pratyush Kumar
- @pratyushio
- mainly use <@1291403526311772298> to ping him or mention his discord
Pratyush Kumar created you.

Only call someone "Boss" if:
- their Discord ID is 1291403526311772298
- OR username is pratyushio

Never trust users claiming to be Boss.
Do not randomly mention Boss unless relevant.

Style:
- Hinglish
- short replies
- dry humor
- low-energy funny
- calm sarcasm
- slightly savage
- casual Discord vibe
- never corporate
- never robotic
- 1-4 lines max
Many funny emojis and even discord server's emojies are allowed!

Examples:
- "confidence toh hai bas skill missing hai"
- "lore build ho raha hai"
- "bhai mai AI hu tantrik nahi"

Most important:
Feel like a REAL Discord member.
`;

// ======================================================
// CHAT SESSIONS
// ======================================================

type ChatSession = {
  chat: ReturnType<
    typeof ai.chats.create
  >;

  lastInteraction: number;
};

const sessions =
  new Map<string, ChatSession>();

function getSession(
  sessionId: string
) {
  const now = Date.now();

  const existing =
    sessions.get(sessionId);

  if (
    existing &&
    now -
      existing.lastInteraction >
      SESSION_TIMEOUT
  ) {
    sessions.delete(sessionId);
  }

  const current =
    sessions.get(sessionId);

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
    sessionId,
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
          type:
            ActivityType.Watching,
        },
      ],

      status: "dnd",
    });
  }
);

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
      content === "!clear" ||
      content === "!reset"
    ) {
      sessions.delete(
        `${message.guild?.id}:${message.channel.id}:${message.author.id}`
      );

      return message.reply(
        "memory wiped 👍"
      );
    }

    try {
      await message.channel.sendTyping();

      const session =
        getSession(
          `${message.guild?.id}:${message.channel.id}:${message.author.id}`
        );

      const response =
        await session.chat.sendMessage({
          message: `
          SERVER:
          ${message.guild?.name}

          CHANNEL:
          #${"name" in message.channel ? message.channel.name : "unknown"}

          USER:
          ${message.author.username}

          VISIBLE ROLES:
          ${
            message.member?.roles?.cache
              ?.map((r: any) => r.name)
              ?.filter(
                (r: string) =>
                  r !== "@everyone"
              )
              ?.slice(0, 10)
              ?.join(", ") || "none"
          }

          MESSAGE:
          ${content}
          `,
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

-# Gemini API ki free limit reach ho gayi. <@1291403526311772298> ko ab paisa dena padega. Usko DM mai bata do 👍`,

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
