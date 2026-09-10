import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { isUuidv7 } from "./uuid.js";
import { ValidationError, ConflictError } from "./exercises.js";

export type BlockType = "single" | "superset";

export interface ProgramEntry {
  id: string;
  exercise_id: string;
  target_sets: number;
  /** Joined for display; never written. */
  exercise_name?: string;
  metric_type?: string;
}

export interface ProgramBlock {
  id: string;
  type: BlockType;
  entries: ProgramEntry[];
}

export interface Program {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  blocks: ProgramBlock[];
}

export interface ProgramInput {
  id: string;
  name: string;
  blocks?: { id: string; type: BlockType; entries: { id: string; exercise_id: string; target_sets: number }[] }[];
  archived_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string;
}

/**
 * A program is edited and saved as one document.
 *
 * Per-node writes would need their own ordering guarantees across a queue that
 * can be interrupted mid-drain; a whole-tree write is atomic in one
 * transaction, coalesces to a single queued entry, and makes reordering — which
 * touches every position at once — a normal save rather than a special case.
 */
export function upsertProgram(db: Database, input: ProgramInput, clock: Clock): Program {
  if (!isUuidv7(input.id)) throw new ValidationError("id must be a UUIDv7", "id");

  const name = (input.name ?? "").trim();
  if (!name) throw new ValidationError("name is required", "name");
  if (name.length > 120) throw new ValidationError("name is longer than 120 characters", "name");

  const blocks = input.blocks ?? [];
  blocks.forEach((block, bi) => {
    if (!isUuidv7(block.id)) throw new ValidationError(`block ${bi + 1} has a bad id`, "blocks");
    if (block.type !== "single" && block.type !== "superset") {
      throw new ValidationError(`block ${bi + 1} must be single or superset`, "blocks");
    }
    if (block.type === "single" && block.entries.length !== 1) {
      throw new ValidationError(
        `block ${bi + 1} is a single block, so it holds exactly one exercise`,
        "blocks",
      );
    }
    if (block.type === "superset" && block.entries.length < 2) {
      throw new ValidationError(
        `block ${bi + 1} is a superset, so it needs at least two exercises`,
        "blocks",
      );
    }
    block.entries.forEach((entry, ei) => {
      if (!isUuidv7(entry.id)) throw new ValidationError(`entry ${ei + 1} has a bad id`, "blocks");
      if (!isUuidv7(entry.exercise_id)) {
        throw new ValidationError(`entry ${ei + 1} has no exercise`, "blocks");
      }
      if (!Number.isInteger(entry.target_sets) || entry.target_sets < 1 || entry.target_sets > 50) {
        throw new ValidationError(
          `entry ${ei + 1}: target sets must be a whole number between 1 and 50`,
          "blocks",
        );
      }
      const ex = db
        .prepare("SELECT id, deleted_at FROM exercise WHERE id = ?")
        .get(entry.exercise_id) as { id: string; deleted_at: string | null } | undefined;
      if (!ex) throw new ValidationError(`entry ${ei + 1} points at an unknown exercise`, "blocks");
      if (ex.deleted_at) {
        throw new ValidationError(`entry ${ei + 1} points at a deleted exercise`, "blocks");
      }
    });
  });

  const now = clock.nowIso();
  const updatedAt = input.updated_at ?? now;

  const run = db.transaction(() => {
    const existing = db
      .prepare("SELECT updated_at FROM program WHERE id = ?")
      .get(input.id) as { updated_at: string } | undefined;

    // Last-write-wins, same rule as exercises: a replay that arrives after a
    // newer edit is ignored rather than resurrecting stale structure.
    if (existing && updatedAt < existing.updated_at) return;

    db.prepare(
      `INSERT INTO program (id, name, created_at, updated_at, archived_at, deleted_at)
       VALUES (@id, @name, @now, @updated_at, @archived_at, @deleted_at)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, updated_at = excluded.updated_at,
         archived_at = excluded.archived_at, deleted_at = excluded.deleted_at`,
    ).run({
      id: input.id,
      name,
      now,
      updated_at: updatedAt,
      archived_at: input.archived_at ?? null,
      deleted_at: input.deleted_at ?? null,
    });

    // Structure is replaced wholesale. Safe to hard-delete: a session snapshots
    // its own copy of the blocks at the moment it starts, so nothing historical
    // depends on these rows.
    db.prepare(
      `DELETE FROM program_entry WHERE block_id IN
         (SELECT id FROM program_block WHERE program_id = ?)`,
    ).run(input.id);
    db.prepare("DELETE FROM program_block WHERE program_id = ?").run(input.id);

    const insBlock = db.prepare(
      `INSERT INTO program_block (id, program_id, position, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insEntry = db.prepare(
      `INSERT INTO program_entry
         (id, block_id, position, exercise_id, target_sets, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Positions come from array order — the client never sends them, so they
    // cannot arrive inconsistent with the order actually shown on screen.
    blocks.forEach((block, bi) => {
      insBlock.run(block.id, input.id, bi, block.type, now, updatedAt);
      block.entries.forEach((entry, ei) => {
        insEntry.run(entry.id, block.id, ei, entry.exercise_id, entry.target_sets, now, updatedAt);
      });
    });
  });

  try {
    run();
  } catch (cause) {
    if ((cause as Error).message.includes("program_name_unique")) {
      throw new ConflictError(`another program is already called "${name}"`);
    }
    throw cause;
  }

  const saved = getProgram(db, input.id);
  if (!saved) throw new Error(`program ${input.id} vanished immediately after write`);
  return saved;
}

export function getProgram(db: Database, id: string): Program | null {
  const row = db
    .prepare(
      `SELECT id, name, created_at, updated_at, archived_at, deleted_at
       FROM program WHERE id = ?`,
    )
    .get(id) as Omit<Program, "blocks"> | undefined;
  if (!row) return null;

  const blocks = db
    .prepare("SELECT id, type FROM program_block WHERE program_id = ? ORDER BY position")
    .all(id) as { id: string; type: BlockType }[];

  const entriesFor = db.prepare(
    `SELECT pe.id, pe.exercise_id, pe.target_sets, e.name AS exercise_name, e.metric_type
     FROM program_entry pe JOIN exercise e ON e.id = pe.exercise_id
     WHERE pe.block_id = ? ORDER BY pe.position`,
  );

  return {
    ...row,
    blocks: blocks.map((b) => ({
      id: b.id,
      type: b.type,
      entries: entriesFor.all(b.id) as ProgramEntry[],
    })),
  };
}

export interface ProgramSummary {
  id: string;
  name: string;
  archived_at: string | null;
  blocks: number;
  planned_sets: number;
}

export function listPrograms(db: Database, include: "active" | "archived" | "all" = "active"): ProgramSummary[] {
  const where =
    include === "active"
      ? "p.deleted_at IS NULL AND p.archived_at IS NULL"
      : include === "archived"
        ? "p.deleted_at IS NULL AND p.archived_at IS NOT NULL"
        : "p.deleted_at IS NULL";

  return db
    .prepare(
      `SELECT p.id, p.name, p.archived_at,
              (SELECT COUNT(*) FROM program_block b WHERE b.program_id = p.id) AS blocks,
              COALESCE((SELECT SUM(pe.target_sets) FROM program_entry pe
                        JOIN program_block b2 ON b2.id = pe.block_id
                        WHERE b2.program_id = p.id), 0) AS planned_sets
       FROM program p WHERE ${where} ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as ProgramSummary[];
}

function setFlag(
  db: Database,
  id: string,
  column: "archived_at" | "deleted_at",
  value: string | null,
  clock: Clock,
): Program {
  if (!getProgram(db, id)) throw new ValidationError(`no program with id ${id}`, "id");
  db.prepare(`UPDATE program SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
    value,
    clock.nowIso(),
    id,
  );
  return getProgram(db, id)!;
}

export const archiveProgram = (db: Database, id: string, c: Clock) => setFlag(db, id, "archived_at", c.nowIso(), c);
export const unarchiveProgram = (db: Database, id: string, c: Clock) => setFlag(db, id, "archived_at", null, c);
export const deleteProgram = (db: Database, id: string, c: Clock) => setFlag(db, id, "deleted_at", c.nowIso(), c);
