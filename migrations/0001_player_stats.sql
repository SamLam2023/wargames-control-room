-- One anonymous browser identity, with monotonic lifetime achievements.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY NOT NULL,
  won INTEGER NOT NULL DEFAULT 0 CHECK (won IN (0, 1)),
  lost INTEGER NOT NULL DEFAULT 0 CHECK (lost IN (0, 1)),
  launched INTEGER NOT NULL DEFAULT 0 CHECK (launched IN (0, 1)),
  averted INTEGER NOT NULL DEFAULT 0 CHECK (averted IN (0, 1))
);

-- Constant-size reads; no full scan of every player on each monitor refresh.
CREATE TABLE IF NOT EXISTS totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  players INTEGER NOT NULL DEFAULT 0,
  winners INTEGER NOT NULL DEFAULT 0,
  losers INTEGER NOT NULL DEFAULT 0,
  launched INTEGER NOT NULL DEFAULT 0,
  averted INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO totals (id) VALUES (1);

CREATE TRIGGER IF NOT EXISTS player_insert AFTER INSERT ON players BEGIN
  UPDATE totals SET
    players = players + 1,
    winners = winners + NEW.won,
    losers = losers + NEW.lost,
    launched = launched + NEW.launched,
    averted = averted + NEW.averted,
    revision = revision + 1
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS player_update AFTER UPDATE ON players BEGIN
  UPDATE totals SET
    winners = winners + NEW.won - OLD.won,
    losers = losers + NEW.lost - OLD.lost,
    launched = launched + NEW.launched - OLD.launched,
    averted = averted + NEW.averted - OLD.averted,
    revision = revision + 1
  WHERE id = 1;
END;
