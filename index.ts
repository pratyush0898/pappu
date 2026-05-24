// ======================================================
// FAST Pappu Discord Bot
// Optimized Gemini 3.1 Flash Lite Version
// ======================================================

import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";

import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/genai";

// ======================================================
// CONFIG
// ======================================================

const BOT_NAME = "Pappu";

const MODEL = "gemini-3.1-flash-lite";

const OWNER = {
  name: "Pratyush Kumar",
  discord: "@pratyushio",
  mention: "<@1291403526311772298>",
};

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
  ],
});

// ======================================================
// SIMPLE MEMORY
// ======================================================

const memory = new Map();

// ======================================================
// SYSTEM PROMPT
// ======================================================

const SYSTEM_PROMPT = `
You are "Pappu" — a funny Hinglish Discord bot.

You are NOT an AI assistant.

You are basically that hilarious Indian internet guy sitting outside a paan shop at 11PM.

Owner:
- ${OWNER.name}
- ${OWNER.discord}
- ${OWNER.mention}

Call him "Boss".

Style:
- Hinglish
- short replies
- casual
- dry humor
- low-energy funny
- slightly savage
- calm sarcasm
- not formal
- not robotic
- 1-3 lines max

Allowed emojis:
😭 💀 👍

Rules:
- never sound corporate
- never overexplain
- roast lightly
- don't force jokes
- serious topic = calm
- confusing stickers/emojis = sarcastic confusion

Examples:
- "bhai yeh server kam family court zyada lag raha hai"
- "confidence toh hai bas skill missing hai"
- "lore build ho raha hai"

Most important:
Talk like a REAL Discord member.
`;

// ======================================================
// HELPERS
// ======================================================

function cleanReply(text = "") {
  return text
    .replace(/As an AI/gi, "")
    .replace(/I am an AI/gi, "")
    .replace(/I'm an AI/gi, "")
    .replace(/```/g, "")
    .trim()
    .slice(0, 300);
}

function updateMemory(message) {
  const old =
    memory.get(message.author.id) || [];

  old.push(message.content);

  if (old.length > 5) {
    old.shift();
  }

  memory.set(message.author.id, old);
}

function shouldRespond(message) {
  if (message.author.bot) return false;

  const mentioned =
    client.user &&
    message.mentions.has(client.user);

  const startsWithPappu =
    message.content
      .toLowerCase()
      .startsWith("pappu");

  const replied =
    message.reference?.messageId;

  const everyonePing =
    message.mentions.everyone;

  const rolePing =
    message.mentions.roles.size > 0;

  const randomReply =
    Math.random() < 0.015;

  return (
    mentioned ||
    startsWithPappu ||
    replied ||
    everyonePing ||
    rolePing ||
    randomReply
  );
}

// ======================================================
// FAST CONTEXT
// ======================================================

function buildContext(message) {
  const member = message.member;

  const recentMessages =
    [...message.channel.messages.cache.values()]
      .slice(-6)
      .map((m) => {
        return `${m.author.username}: ${m.content}`;
      })
      .join("\n");

  const userMemory =
    memory.get(message.author.id);

  const stickers =
    message.stickers.size > 0
      ? message.stickers
          .map((s) => s.name)
          .join(", ")
      : "none";

  return `
SERVER:
${message.guild?.name}

CHANNEL:
#${message.channel.name}

USER:
${message.author.username}

DISPLAY NAME:
${member?.displayName || "unknown"}

STATUS:
${member?.presence?.status || "unknown"}

ACTIVITY:
${
  member?.presence?.activities
    ?.map((a) => a.name)
    .join(", ") || "none"
}

ROLES:
${
  member?.roles?.cache
    ?.map((r) => r.name)
    .filter((r) => r !== "@everyone")
    .slice(0, 5)
    .join(", ") || "none"
}

STICKERS:
${stickers}

MEMORY:
${userMemory?.join("\n") || "none"}

RECENT CHAT:
${recentMessages}

CURRENT MESSAGE:
${message.content}
`;
}

// ======================================================
// GEMINI
// ======================================================

async function generateReply(context) {
  const response =
    await ai.models.generateContent({
      model: MODEL,

      config: {
        maxOutputTokens: 80,

        temperature: 1,

        thinkingConfig: {
          thinkingBudget: 0,
        },

        safetySettings: [
          {
            category:
              HarmCategory
                .HARM_CATEGORY_HARASSMENT,

            threshold:
              HarmBlockThreshold.BLOCK_NONE,
          },

          {
            category:
              HarmCategory
                .HARM_CATEGORY_HATE_SPEECH,

            threshold:
              HarmBlockThreshold.BLOCK_NONE,
          },

          {
            category:
              HarmCategory
                .HARM_CATEGORY_SEXUALLY_EXPLICIT,

            threshold:
              HarmBlockThreshold.BLOCK_NONE,
          },

          {
            category:
              HarmCategory
                .HARM_CATEGORY_DANGEROUS_CONTENT,

            threshold:
              HarmBlockThreshold.BLOCK_NONE,
          },
        ],

        systemInstruction: [
          {
            text: SYSTEM_PROMPT,
          },
        ],
      },

      contents: [
        {
          role: "user",

          parts: [
            {
              text: context,
            },
          ],
        },
      ],
    });

  return cleanReply(response.text);
}

// ======================================================
// READY
// ======================================================

client.once("clientReady", () => {
  console.log(
    `\n✅ ${BOT_NAME} Online as ${client.user.tag}\n`
  );

  console.log(
    `📌 Servers: ${client.guilds.cache.size}\n`
  );

  client.guilds.cache.forEach((guild) => {
    console.log(
      `• ${guild.name} (${guild.memberCount} members)`
    );
  });

  client.user.setPresence({
    status: "online",

    activities: [
      {
        name: "server ka scene dekh raha",
        type: ActivityType.Watching,
      },
    ],
  });
});

// ======================================================
// MESSAGE EVENT
// ======================================================

client.on(
  "messageCreate",
  async (message) => {
    try {
      if (!shouldRespond(message))
        return;

      updateMemory(message);

      await message.channel.sendTyping();

      const context =
        buildContext(message);

      const reply =
        await generateReply(context);

      if (!reply) return;

      await message.reply({
        content: reply,

        allowedMentions: {
          repliedUser: false,

          users: [
            ...message.mentions.users.keys(),
          ],

          roles: [
            ...message.mentions.roles.keys(),
          ],

          parse: [],
        },
      });
    } catch (err) {
      console.error(err);

      try {
        await message.reply(
          "bhai system ko chakkar aa gaya 😭"
        );
      } catch {}
    }
  }
);

// ======================================================
// LOGIN
// ======================================================

client.login(process.env.DISCORD_TOKEN);
