use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;

pub struct StatsDb(pub Mutex<Connection>);

#[derive(Serialize)]
pub struct ToolStats {
    pub tool: String,
    pub uses: i64,
    pub unique_users: i64,
}

#[derive(Serialize)]
pub struct StatsData {
    pub total_uses: i64,
    pub total_unique_users: i64,
    pub tools: Vec<ToolStats>,
}

impl StatsDb {
    pub fn new(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tool_events (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_slug  TEXT    NOT NULL,
                session_id TEXT    NOT NULL,
                created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_tool ON tool_events(tool_slug);",
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn record(&self, tool_slug: &str, session_id: &str) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO tool_events (tool_slug, session_id, created_at) VALUES (?1, ?2, ?3)",
            params![tool_slug, session_id, now],
        )?;
        Ok(())
    }

    pub fn get_stats(&self) -> rusqlite::Result<StatsData> {
        let conn = self.0.lock().unwrap();
        let total_uses: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tool_events",
            [],
            |r| r.get(0),
        )?;
        let total_unique_users: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT session_id) FROM tool_events",
            [],
            |r| r.get(0),
        )?;
        let mut stmt = conn.prepare(
            "SELECT tool_slug, COUNT(*) AS uses, COUNT(DISTINCT session_id) AS unique_users
             FROM tool_events
             GROUP BY tool_slug
             ORDER BY uses DESC",
        )?;
        let tools: Vec<ToolStats> = stmt
            .query_map([], |r| {
                Ok(ToolStats {
                    tool: r.get(0)?,
                    uses: r.get(1)?,
                    unique_users: r.get(2)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(StatsData { total_uses, total_unique_users, tools })
    }
}
