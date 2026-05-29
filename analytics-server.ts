// analytics-server.ts

import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";

const app = express();

const PORT = 3000;

// ======================================================
// DATABASE
// ======================================================

const db = new Database("usage.db");

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

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());

app.use(express.json());

app.use(
  express.static(
    path.join(process.cwd(), "public")
  )
);

// ======================================================
// API
// ======================================================

app.get("/api/stats", (req, res) => {

  const timeframe =
    String(
      req.query.timeframe || "24h"
    );

  const guildId =
    String(
      req.query.guildId || ""
    );

  const userId =
    String(
      req.query.userId || ""
    );

  let timeframeSQL =
    "-24 hours";

  if (timeframe === "7d") {
    timeframeSQL = "-7 days";
  }

  if (timeframe === "30d") {
    timeframeSQL = "-30 days";
  }

  if (timeframe === "today") {
    timeframeSQL = "start of day";
  }

  const where: string[] = [];

  const params: any[] = [];

  if (timeframe === "today") {
    where.push(`
      datetime(
        created_at,
        '+5 hours',
        '+30 minutes'
      ) >= datetime(
        'now',
        'start of day',
        '+5 hours',
        '+30 minutes'
      )
    `);
  } else {
    where.push(`
      created_at >= datetime(
        'now',
        ?
      )
    `);

    params.push(
      timeframeSQL
    );
  }

  if (guildId) {
    where.push(
      "guild_id = ?"
    );

    params.push(guildId);
  }

  if (userId) {
    where.push(
      "user_id = ?"
    );

    params.push(userId);
  }

  const whereSQL =
    where.length
      ? `WHERE ${where.join(" AND ")}`
      : "";

  const totalTokens =
    db
      .prepare(`
        SELECT
          COALESCE(
            SUM(total_tokens),
            0
          ) as total
        FROM usage_logs
        ${whereSQL}
      `)
      .get(...params) as any;

  const totalRequests =
    db
      .prepare(`
        SELECT
          COUNT(*) as total
        FROM usage_logs
        ${whereSQL}
      `)
      .get(...params) as any;

  const totalUsers =
    db
      .prepare(`
        SELECT
          COUNT(
            DISTINCT user_id
          ) as total
        FROM usage_logs
        ${whereSQL}
      `)
      .get(...params) as any;

  const totalServers =
    db
      .prepare(`
        SELECT
          COUNT(
            DISTINCT guild_id
          ) as total
        FROM usage_logs
        ${whereSQL}
      `)
      .get(...params) as any;

  const logs =
    db
      .prepare(`
        SELECT *
        FROM usage_logs
        ${whereSQL}
        ORDER BY created_at DESC
        LIMIT 100
      `)
      .all(...params);

  const usageChart =
    db
      .prepare(`
        SELECT
          strftime(
            '%d/%m %H:00',
            datetime(
              created_at,
              '+5 hours',
              '+30 minutes'
            )
          ) as label,

          SUM(total_tokens)
            as tokens

        FROM usage_logs

        ${whereSQL}

        GROUP BY label
        ORDER BY created_at ASC
      `)
      .all(...params);

  const serverChart =
    db
      .prepare(`
        SELECT
          guild_name,

          SUM(total_tokens)
            as tokens

        FROM usage_logs

        ${whereSQL}

        GROUP BY guild_id

        ORDER BY tokens DESC

        LIMIT 10
      `)
      .all(...params);

  const topUsers =
    db
      .prepare(`
        SELECT
          username,

          SUM(total_tokens)
            as tokens

        FROM usage_logs

        ${whereSQL}

        GROUP BY user_id

        ORDER BY tokens DESC

        LIMIT 10
      `)
      .all(...params);

  const topChannels =
    db
      .prepare(`
        SELECT
          channel_name,

          SUM(total_tokens)
            as tokens

        FROM usage_logs

        ${whereSQL}

        GROUP BY channel_id

        ORDER BY tokens DESC

        LIMIT 10
      `)
      .all(...params);

  const guilds =
    db
      .prepare(`
        SELECT DISTINCT
          guild_id,
          guild_name
        FROM usage_logs
        ORDER BY guild_name ASC
      `)
      .all();

  const users =
    db
      .prepare(`
        SELECT DISTINCT
          user_id,
          username
        FROM usage_logs
        ORDER BY username ASC
      `)
      .all();

  res.json({
    stats: {
      totalTokens:
        totalTokens.total,

      totalRequests:
        totalRequests.total,

      totalUsers:
        totalUsers.total,

      totalServers:
        totalServers.total,
    },

    logs,

    usageChart,

    serverChart,

    topUsers,

    topChannels,

    guilds,

    users,
  });
});

// ======================================================
// START
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `✅ Analytics running on port ${PORT}`
    );
  }
);
