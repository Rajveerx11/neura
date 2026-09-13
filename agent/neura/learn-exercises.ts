import { spawn } from "node:child_process";

export type SqlValue = string | number | null;
export type LearnTable = { name: string; columns: { name: string; type: "TEXT" | "INTEGER" | "REAL" }[]; rows: SqlValue[][] };
type ExerciseBase = { prompt: string; hints: string[]; explanation: string };
export type LearnExercise = ExerciseBase & (
  | { kind: "choice"; options: string[]; answer: number }
  | { kind: "short"; acceptedAnswers: string[] }
  | { kind: "sql"; tables: LearnTable[]; expectedRows?: Record<string, SqlValue>[]; solution: string }
);
export type LearnExerciseResult = { correct: boolean | null; feedback: string; rows?: Record<string, SqlValue>[]; truncated?: boolean };

export function learnText(value: unknown, label: string, max = 1200): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new Error(`${label} must be nonempty text, at most ${max} characters, without control characters.`);
  }
}
export function learnArray(value: unknown, label: string, min: number, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain ${min}-${max} items.`);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function sqlValue(value: unknown): value is SqlValue {
  return value === null || (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) || (typeof value === "string" && value.length <= 1000);
}
export function assertLearnExercise(value: unknown): asserts value is LearnExercise {
  if (!record(value)) throw new Error("Exercise must be an object.");
  learnText(value.prompt, "exercise.prompt");
  learnText(value.explanation, "exercise.explanation", 2000);
  learnArray(value.hints, "exercise.hints", 1, 5);
  value.hints.forEach((hint) => learnText(hint, "hint", 500));
  if (value.kind === "choice") {
    learnArray(value.options, "exercise.options", 2, 6);
    value.options.forEach((option) => learnText(option, "option", 500));
    if (!Number.isInteger(value.answer) || Number(value.answer) < 0 || Number(value.answer) >= value.options.length) throw new Error("Choice answer must be a zero-based option index.");
  } else if (value.kind === "short") {
    learnArray(value.acceptedAnswers, "exercise.acceptedAnswers", 0, 10);
    value.acceptedAnswers.forEach((answer) => learnText(answer, "accepted answer", 500));
  } else if (value.kind === "sql") {
    learnText(value.solution, "exercise.solution", 8000);
    learnArray(value.tables, "exercise.tables", 1, 8);
    const names = new Set<string>();
    let cells = 0;
    for (const table of value.tables) {
      if (!record(table) || typeof table.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(table.name) || table.name.toLowerCase().startsWith("sqlite_") || names.has(table.name.toLowerCase())) throw new Error("SQL tables require unique simple identifiers.");
      names.add(table.name.toLowerCase());
      learnArray(table.columns, "table.columns", 1, 12);
      const columns = new Set<string>();
      for (const column of table.columns) {
        if (!record(column) || typeof column.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(column.name) || columns.has(column.name.toLowerCase()) || !["TEXT", "INTEGER", "REAL"].includes(String(column.type))) throw new Error("SQL columns require unique simple identifiers and TEXT, INTEGER or REAL types.");
        columns.add(column.name.toLowerCase());
      }
      learnArray(table.rows, "table.rows", 0, 200);
      for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length || !row.every(sqlValue)) throw new Error("SQL rows must match columns and contain bounded strings, finite safe numbers, or null.");
        cells += row.length;
      }
    }
    if (cells > 2400 || JSON.stringify(value.tables).length > 200_000) throw new Error("SQL fixture exceeds the lab size limit.");
    if (value.expectedRows !== undefined) {
      learnArray(value.expectedRows, "exercise.expectedRows", 0, 200);
      if (!value.expectedRows.every((row) => record(row) && Object.keys(row).length <= 12 && Object.keys(row).every((key) => key.length <= 100) && Object.values(row).every(sqlValue))) throw new Error("Expected rows must contain bounded SQL values.");
    }
  } else throw new Error("Exercise kind must be choice, short or sql.");
}

// Fixed program; learner input reaches stdin only. SQL never becomes JavaScript or shell text.
// Separate process makes SQLite's native heap cap local to this one disposable lab.
const SQL_WORKER = String.raw`
const { DatabaseSync, constants: c } = require('node:sqlite');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if(input.length > 240000) process.exit(2); });
process.stdin.on('end', () => {
  let db;
  try {
    const { tables, query } = JSON.parse(input);
    db = new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
    if (typeof db.setAuthorizer !== 'function') throw new Error('SQL practice requires Node 24.15 or later.');
    db.exec('PRAGMA temp_store=MEMORY; PRAGMA hard_heap_limit=33554432; PRAGMA journal_mode=MEMORY;');
    for (const table of tables) {
      db.exec('CREATE TABLE "'+table.name+'" ('+table.columns.map(col=>'"'+col.name+'" '+col.type).join(',')+')');
      const insert=db.prepare('INSERT INTO "'+table.name+'" VALUES ('+table.columns.map(()=>'?').join(',')+')');
      for(const row of table.rows) insert.run(...row);
    }
    db.exec('PRAGMA query_only=ON');
    const names = new Set(tables.map(table=>table.name.toLowerCase()));
    const functions = new Set(['count','sum','avg','min','max','total','round','abs','lower','upper','length','coalesce','ifnull','nullif','substr','substring','trim','ltrim','rtrim','typeof']);
    db.setAuthorizer((code,a,b,database)=> {
      if(code===c.SQLITE_SELECT) return c.SQLITE_OK;
      if(code===c.SQLITE_READ && (database==='main' || database===null) && names.has(String(a).toLowerCase())) return c.SQLITE_OK;
      if(code===c.SQLITE_FUNCTION && functions.has(String(b).toLowerCase())) return c.SQLITE_OK;
      return c.SQLITE_DENY;
    });
    const statement=db.prepare(query);
    if(statement.columns().length > 12) throw new Error('Use at most 12 result columns.');
    const labels=statement.columns().map(column=>column.name);
    if(new Set(labels).size!==labels.length) throw new Error('Use unique column aliases in the result.');
    const rows=[]; let truncated=false;
    for(const row of statement.iterate()) {
      if(rows.length===200) { truncated=true; break; }
      for(const cell of Object.values(row)) {
        if(typeof cell==='number' && (!Number.isFinite(cell) || Math.abs(cell)>Number.MAX_SAFE_INTEGER)) throw new Error('Numeric results must be finite and within the safe number range.');
        if(typeof cell==='string' && cell.length>1000 || cell instanceof Uint8Array) throw new Error('Result cells must be text up to 1000 characters, numbers or null.');
      }
      rows.push(row);
      if(JSON.stringify(rows).length>200000) throw new Error('Result exceeds the lab size limit.');
    }
    process.stdout.write(JSON.stringify({rows,truncated}));
  } catch(error) { process.stdout.write(JSON.stringify({error:String(error.message).slice(0,500)})); }
  finally { if(db) db.close(); }
});`;

async function runSql(tables: LearnTable[], answer: string): Promise<{ rows: Record<string, SqlValue>[]; truncated: boolean }> {
  // This intentionally excludes comments before SELECT and embedded semicolons.
  const query = answer.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(query) || query.includes(";") || query.includes("\0")) throw new Error("Use one SELECT query (or nonrecursive WITH), without embedded semicolons.");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=64", "--no-warnings", "--input-type=commonjs", "-e", SQL_WORKER], {
      shell: false, windowsHide: true, env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error, result?: { rows: Record<string, SqlValue>[]; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error("Query exceeded the 3 second lab limit. Simplify the query.")), 3000);
    child.on("error", () => finish(new Error("Could not start SQL lab. Node 24.15 or later is required.")));
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 220_000) finish(new Error("SQL result exceeds the lab size limit."));
    });
    child.stderr.resume();
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0) throw new Error("SQL lab stopped at its resource limit or could not load Node SQLite.");
        const result = JSON.parse(output);
        if (result.error) throw new Error(result.error);
        finish(undefined, result);
      } catch (error) { finish(error instanceof Error ? error : new Error("SQL lab failed.")); }
    });
    child.stdin.end(JSON.stringify({ tables, query }));
  });
}

function normalized(value: string): string { return value.trim().replace(/\s+/g, " ").toLowerCase(); }
function canonicalRows(rows: Record<string, SqlValue>[]): string {
  return JSON.stringify(rows.map((row) => JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]))).sort());
}
export async function evaluateLearnExercise(exercise: LearnExercise, answer: string): Promise<LearnExerciseResult> {
  assertLearnExercise(exercise);
  learnText(answer, "answer", 8000);
  if (exercise.kind === "choice") {
    // User-visible answers are numbered from 1; the authoring index is zero-based.
    const choice = /^\d+$/.test(answer.trim()) ? Number(answer.trim()) - 1 : exercise.options.findIndex((option) => normalized(option) === normalized(answer));
    const correct = choice === exercise.answer;
    return { correct, feedback: correct ? `Correct. ${exercise.explanation}` : "That choice does not fit yet. Try a hint and compare the alternatives." };
  }
  if (exercise.kind === "short") {
    if (!exercise.acceptedAnswers.length) return { correct: null, feedback: "Open-ended attempt recorded for tutor review. Compare your reasoning with the example; this exercise is not automatically graded." };
    const correct = exercise.acceptedAnswers.some((accepted) => normalized(accepted) === normalized(answer));
    return { correct, feedback: correct ? `Matches the expected answer. ${exercise.explanation}` : "No exact match. Check the hint, or ask the tutor to review your reasoning; wording can differ." };
  }
  try {
    const result = await runSql(exercise.tables, answer);
    const correct = exercise.expectedRows === undefined || result.truncated ? null : canonicalRows(result.rows) === canonicalRows(exercise.expectedRows);
    return { ...result, correct, feedback: result.truncated ? "Showing the first 200 rows. Add a filter or LIMIT; this attempt is not graded." : correct === null ? "Query ran. Inspect the rows with your tutor; this exercise has no automatic answer key." : correct ? `Result matches, including column names and duplicates; row order is ignored. ${exercise.explanation}` : "Query ran, but its rows or column names differ from the expected result. Inspect the output and try a hint." };
  } catch (error) {
    return { correct: false, feedback: `SQL lab: ${error instanceof Error ? error.message : "query failed"}` };
  }
}
