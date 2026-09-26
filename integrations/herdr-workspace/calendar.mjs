import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const candidates = [path.join(os.homedir(), ".local", "bin", "gcalcli.exe"), "gcalcli"];
const gcalcli = candidates.find((candidate) => candidate === "gcalcli" || fs.existsSync(candidate));
export const calendarCommands = Object.freeze({
  "1": ["--lineart", "unicode", "calm"],
  "2": ["--lineart", "unicode", "calw", "today", "2"],
  "3": ["agenda", "today", "+14d", "--details", "calendar", "--details", "location"],
  "4": ["add"],
  "6": ["list"],
  a: ["init"],
});
export function calendarEditArgs(query) { return ["edit", query]; }

function clear() { process.stdout.write("\x1b[2J\x1b[H"); }
function run(args) {
  clear();
  const result = spawnSync(gcalcli, args, { stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
async function main() {
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
async function pause() { await rl.question("\nPress Enter to return to Calendar."); }
try {
  if (!gcalcli) throw new Error("gcalcli is unavailable. Install it with: uv tool install 'gcalcli==4.5.1'");
  while (true) {
    clear();
    console.log(" NEURA / GOOGLE CALENDAR");
    console.log(" Calendar data stays in this terminal pane. OAuth is owned by gcalcli.\n");
    console.log(" 1  Month view");
    console.log(" 2  Two-week view");
    console.log(" 3  Agenda (next 14 days)");
    console.log(" 4  Add event interactively");
    console.log(" 5  Find and edit event");
    console.log(" 6  List calendars");
    console.log(" a  Authenticate / refresh Google access");
    console.log(" q  Close pane\n");
    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") break;
    if (calendarCommands[answer]) { run(calendarCommands[answer]); await pause(); }
    else if (answer === "5") {
      const query = (await rl.question("Event title/search text: ")).trim();
      if (query) { run(calendarEditArgs(query)); await pause(); }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await rl.question("Press Enter to close.");
  process.exitCode = 1;
} finally {
  rl.close();
}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
