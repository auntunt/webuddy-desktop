/** 小组表与 users.group_id 列；老库在 openDb 时幂等补齐。 */

const GROUPS_TABLE = `
CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
`

export function ensureGroupSchema(db) {
  db.exec(GROUPS_TABLE)
  // Why PRAGMA：SQLite 没有 ADD COLUMN IF NOT EXISTS，重复加列会报错。
  const hasGroupId = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .some((column) => column.name === 'group_id')
  if (!hasGroupId) {
    db.exec('ALTER TABLE users ADD COLUMN group_id TEXT NULL REFERENCES groups(id)')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id)')
}
