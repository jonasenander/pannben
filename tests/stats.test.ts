import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise, ValidationError, type MetricType } from "../src/data/exercises.js";
import { upsertProgram } from "../src/data/programs.js";
import {
  startSession, logSet, finishSession, updateSession, deleteSession, deleteSet,
  type LogSetInput,
} from "../src/data/sessions.js";
import {
  exerciseSeries, trendLine, metricsFor, favourites, setFavourites, favouriteSeries,
} from "../src/data/stats.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const ZONE = "Europe/Stockholm";
const at = (iso: string): Clock => fixedClock(iso);

let db: Database;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
});

function makeExercise(name: string, metric_type: MetricType): string {
  const id = uuidv7();
  upsertExercise(db, { id, name, metric_type }, at("2026-01-01T09:00:00Z"));
  return id;
}

/**
 * One session on `day` logging the given sets against one exercise.
 * Returns the session id so a test can delete or move it.
 */
function session(day: string, exerciseId: string, sets: Partial<LogSetInput>[]): string {
  const clock = at(`${day}T09:00:00Z`);
  const program = uuidv7();
  upsertProgram(db, {
    id: program, name: `P ${day}`,
    blocks: [{ id: uuidv7(), type: "single",
               entries: [{ id: uuidv7(), exercise_id: exerciseId, target_sets: sets.length || 1 }] }],
  }, clock);

  const id = uuidv7();
  const s = startSession(db, { id, program_id: program }, clock, ZONE);
  const ex = s.blocks[0]!.exercises[0]!;
  sets.forEach((set, i) => {
    logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: i, ...set } as LogSetInput, clock);
  });
  finishSession(db, id, clock);
  updateSession(db, id, { date: day }, clock);
  return id;
}

const valuesOf = (points: { values: Record<string, number | null> }[], key: string) =>
  points.map((p) => p.values[key] ?? null);

describe("what each metric type can be charted by", () => {
  it("offers volume, top set and estimated 1RM for a barbell lift", () => {
    expect(metricsFor("total_weight").map((m) => m.key))
      .toEqual(["volume", "top_weight", "e1rm"]);
  });

  it("charts reps rather than volume for a bodyweight exercise", () => {
    const keys = metricsFor("bodyweight").map((m) => m.key);
    expect(keys).toContain("reps");
    expect(keys).not.toContain("volume");
  });

  it("does not offer a 1RM for added-weight work, where the number would be a fiction", () => {
    // The bar is your body; Epley over the *added* plate alone means nothing.
    expect(metricsFor("bodyweight_plus").map((m) => m.key)).not.toContain("e1rm");
  });

  it("charts holds by longest hold and total time under load", () => {
    expect(metricsFor("hold").map((m) => m.key)).toEqual(["best_hold", "time_under_load"]);
  });

  it("gives every metric a label and a unit, since the axis has to say something", () => {
    for (const type of ["total_weight", "dumbbell", "bodyweight", "bodyweight_plus",
                        "cardio", "hold"] as MetricType[]) {
      for (const m of metricsFor(type)) {
        expect(m.label.length).toBeGreaterThan(0);
        expect(m.unit.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the series", () => {
  it("gives one point per session, oldest first, so the line reads left to right", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-06", bench, [{ weight: 80, reps: 8 }]);
    session("2026-03-02", bench, [{ weight: 75, reps: 8 }]);
    session("2026-03-04", bench, [{ weight: 77.5, reps: 8 }]);

    const s = exerciseSeries(db, bench);
    expect(s.points.map((p) => p.date)).toEqual(["2026-03-02", "2026-03-04", "2026-03-06"]);
    expect(valuesOf(s.points, "top_weight")).toEqual([75, 77.5, 80]);
  });

  it("sums volume as weight × reps", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [
      { weight: 80, reps: 8 }, { weight: 80, reps: 7 }, { weight: 75, reps: 8 },
    ]);
    expect(valuesOf(exerciseSeries(db, bench).points, "volume"))
      .toEqual([80 * 8 + 80 * 7 + 75 * 8]);
  });

  it("counts a dumbbell twice, because both hands did the work", () => {
    const db2 = makeExercise("Incline dumbbell press", "dumbbell");
    session("2026-03-02", db2, [{ weight: 30, reps: 10 }]);
    expect(valuesOf(exerciseSeries(db, db2).points, "volume")).toEqual([30 * 2 * 10]);
    // The top set is still what you picked up in one hand.
    expect(valuesOf(exerciseSeries(db, db2).points, "top_weight")).toEqual([30]);
  });

  it("charts a bodyweight exercise by total reps and best set", () => {
    const pullup = makeExercise("Pull-up", "bodyweight");
    session("2026-03-02", pullup, [{ reps: 10 }, { reps: 8 }, { reps: 6 }]);
    const s = exerciseSeries(db, pullup);
    expect(valuesOf(s.points, "reps")).toEqual([24]);
    expect(valuesOf(s.points, "best_set")).toEqual([10]);
  });

  it("charts a hold by longest hold and total time under load", () => {
    const plank = makeExercise("Plank", "hold");
    session("2026-03-02", plank, [{ duration_s: 60 }, { duration_s: 75 }, { duration_s: 45 }]);
    const s = exerciseSeries(db, plank);
    expect(valuesOf(s.points, "best_hold")).toEqual([75]);
    expect(valuesOf(s.points, "time_under_load")).toEqual([180]);
  });
});

describe("estimated 1RM", () => {
  const epley = (w: number, r: number) => Math.round(w * (1 + r / 30) * 100) / 100;

  it("uses Epley on the best set", () => {
    const bench = makeExercise("Bench press", "total_weight");
    // 100×3 = 110; 80×8 = 101.3. The heavier single wins.
    session("2026-03-02", bench, [{ weight: 80, reps: 8 }, { weight: 100, reps: 3 }]);
    expect(valuesOf(exerciseSeries(db, bench).points, "e1rm")).toEqual([epley(100, 3)]);
  });

  it("is suppressed above 12 reps rather than plotted wrong", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [{ weight: 40, reps: 20 }]);
    // A gap in the line is honest. Epley over a set of 20 is not.
    expect(valuesOf(exerciseSeries(db, bench).points, "e1rm")).toEqual([null]);
  });

  it("still reports the sets it can, when only some are in range", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [{ weight: 40, reps: 20 }, { weight: 90, reps: 5 }]);
    expect(valuesOf(exerciseSeries(db, bench).points, "e1rm")).toEqual([epley(90, 5)]);
  });
});

describe("what the series refuses to count", () => {
  it("ignores a skipped set: it records a decision, not work", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [{ weight: 80, reps: 8 }, { skipped: true }]);
    expect(valuesOf(exerciseSeries(db, bench).points, "volume")).toEqual([640]);
  });

  it("produces no point at all for a session that was entirely skipped", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [{ weight: 80, reps: 8 }]);
    session("2026-03-04", bench, [{ skipped: true }, { skipped: true }]);
    // A zero here would read as a catastrophic drop rather than a rest day.
    expect(exerciseSeries(db, bench).points.map((p) => p.date)).toEqual(["2026-03-02"]);
  });

  it("ignores a deleted set", () => {
    const bench = makeExercise("Bench press", "total_weight");
    session("2026-03-02", bench, [{ weight: 80, reps: 8 }, { weight: 80, reps: 8 }]);
    const anySet = db.prepare("SELECT id FROM logged_set LIMIT 1").get() as { id: string };
    deleteSet(db, anySet.id, at("2026-03-03T09:00:00Z"));
    expect(valuesOf(exerciseSeries(db, bench).points, "volume")).toEqual([640]);
  });

  it("ignores a deleted session", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const gone = session("2026-03-02", bench, [{ weight: 80, reps: 8 }]);
    session("2026-03-04", bench, [{ weight: 85, reps: 8 }]);
    deleteSession(db, gone, at("2026-03-05T09:00:00Z"));
    expect(exerciseSeries(db, bench).points.map((p) => p.date)).toEqual(["2026-03-04"]);
  });

  it("keeps an archived exercise's history, which is the point of archiving", () => {
    const pec = makeExercise("Pec deck", "total_weight");
    session("2026-03-02", pec, [{ weight: 50, reps: 12 }]);
    upsertExercise(db, { id: pec, name: "Pec deck", metric_type: "total_weight",
      archived_at: "2026-03-03T09:00:00Z" }, at("2026-03-03T09:00:00Z"));

    expect(exerciseSeries(db, pec).points).toHaveLength(1);
  });
});

describe("range", () => {
  it("clips to a from/to window", () => {
    const bench = makeExercise("Bench press", "total_weight");
    for (const d of ["2026-01-05", "2026-02-05", "2026-03-05"]) {
      session(d, bench, [{ weight: 80, reps: 8 }]);
    }
    expect(exerciseSeries(db, bench, { from: "2026-02-01" }).points.map((p) => p.date))
      .toEqual(["2026-02-05", "2026-03-05"]);
    expect(exerciseSeries(db, bench, { to: "2026-02-28" }).points.map((p) => p.date))
      .toEqual(["2026-01-05", "2026-02-05"]);
  });

  it("comes back empty, not broken, for an exercise never done", () => {
    const never = makeExercise("Zercher squat", "total_weight");
    const s = exerciseSeries(db, never);
    expect(s.points).toEqual([]);
    expect(s.exercise_name).toBe("Zercher squat");
  });
});

describe("the trend line", () => {
  it("finds the slope of a straight line", () => {
    // Two weeks apart, +7 kg: half a kilo a day.
    const line = trendLine([
      { date: "2026-03-01", value: 100 },
      { date: "2026-03-08", value: 103.5 },
      { date: "2026-03-15", value: 107 },
    ]);
    expect(line!.slope_per_day).toBeCloseTo(0.5, 6);
    expect(line!.at("2026-03-01")).toBeCloseTo(100, 6);
    expect(line!.at("2026-03-15")).toBeCloseTo(107, 6);
  });

  it("is flat when nothing changed", () => {
    const line = trendLine([
      { date: "2026-03-01", value: 80 },
      { date: "2026-03-08", value: 80 },
    ]);
    expect(line!.slope_per_day).toBe(0);
  });

  it("measures in days, not in points, so an irregular gap does not lie", () => {
    // Three sessions, but the third is a month later. Fitting by index would
    // draw a far steeper line than the training actually was.
    const byDays = trendLine([
      { date: "2026-03-01", value: 100 },
      { date: "2026-03-02", value: 101 },
      { date: "2026-04-01", value: 110 },
    ])!;
    expect(byDays.slope_per_day).toBeLessThan(0.4);
  });

  it("refuses to draw a trend through one point, or none", () => {
    expect(trendLine([{ date: "2026-03-01", value: 100 }])).toBeNull();
    expect(trendLine([])).toBeNull();
  });

  it("skips gaps rather than treating them as zero", () => {
    const line = trendLine([
      { date: "2026-03-01", value: 100 },
      { date: "2026-03-08", value: null },
      { date: "2026-03-15", value: 107 },
    ]);
    expect(line!.slope_per_day).toBeCloseTo(0.5, 6);
  });

  it("refuses when every point on two dates is the same day", () => {
    // Zero variance in x: the fit is a vertical line, which is not a trend.
    expect(trendLine([
      { date: "2026-03-01", value: 100 },
      { date: "2026-03-01", value: 110 },
    ])).toBeNull();
  });
});

describe("pinned charts", () => {
  it("starts empty", () => {
    expect(favourites(db)).toEqual([]);
  });

  it("saves the pinned list as one document, in the order given", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const squat = makeExercise("Squat", "total_weight");
    const clock = at("2026-03-01T09:00:00Z");

    setFavourites(db, [
      { kind: "exercise", ref_id: squat },
      { kind: "exercise", ref_id: bench },
    ], clock);

    expect(favourites(db).map((f) => f.ref_id)).toEqual([squat, bench]);
  });

  it("reordering is an ordinary save, not a special endpoint", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const squat = makeExercise("Squat", "total_weight");
    const clock = at("2026-03-01T09:00:00Z");

    setFavourites(db, [{ kind: "exercise", ref_id: bench },
                       { kind: "exercise", ref_id: squat }], clock);
    setFavourites(db, [{ kind: "exercise", ref_id: squat },
                       { kind: "exercise", ref_id: bench }], clock);

    expect(favourites(db).map((f) => f.ref_id)).toEqual([squat, bench]);
  });

  it("refuses to pin the same thing twice", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const clock = at("2026-03-01T09:00:00Z");
    expect(() => setFavourites(db, [
      { kind: "exercise", ref_id: bench },
      { kind: "exercise", ref_id: bench },
    ], clock)).toThrow(ValidationError);
  });

  it("refuses to pin an exercise that does not exist", () => {
    expect(() => setFavourites(db, [{ kind: "exercise", ref_id: uuidv7() }],
      at("2026-03-01T09:00:00Z"))).toThrow(ValidationError);
  });

  it("returns each pinned chart's series in one read, so the dashboard is one request", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const pullup = makeExercise("Pull-up", "bodyweight");
    session("2026-03-02", bench, [{ weight: 80, reps: 8 }]);
    session("2026-03-04", pullup, [{ reps: 10 }]);

    setFavourites(db, [{ kind: "exercise", ref_id: bench },
                       { kind: "exercise", ref_id: pullup }], at("2026-03-05T09:00:00Z"));

    const charts = favouriteSeries(db);
    expect(charts.map((c) => c.exercise_name)).toEqual(["Bench press", "Pull-up"]);
    expect(charts[0]!.points).toHaveLength(1);
    expect(charts[1]!.metrics[0]!.key).toBe("reps");
  });

  it("drops a pin whose exercise was deleted, rather than breaking the dashboard", () => {
    const bench = makeExercise("Bench press", "total_weight");
    const gone = makeExercise("Pec deck", "total_weight");
    const clock = at("2026-03-05T09:00:00Z");
    setFavourites(db, [{ kind: "exercise", ref_id: bench },
                       { kind: "exercise", ref_id: gone }], clock);

    upsertExercise(db, { id: gone, name: "Pec deck", metric_type: "total_weight",
      deleted_at: clock.nowIso() }, clock);

    expect(favouriteSeries(db).map((c) => c.exercise_name)).toEqual(["Bench press"]);
  });
});
