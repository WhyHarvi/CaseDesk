#!/usr/bin/env node
// Runs before nodemon starts (see "predev") so a stale process left holding
// the dev port — a crashed prior session, a stray manual `node src/server.js`,
// a duplicate terminal tab — never blocks startup with EADDRINUSE. Only
// touches processes that are actually node and actually bound to this exact
// port; never a blind port sweep.
import { execSync } from "node:child_process";
import { config } from "dotenv";

config();

const port = Number(process.env.PORT) || 5000;

function pidsOnPort() {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== process.pid);
  } catch {
    return [];
  }
}

function isNodeProcess(pid) {
  try {
    return execSync(`ps -p ${pid} -o comm=`, { stdio: ["ignore", "pipe", "ignore"] }).toString().includes("node");
  } catch {
    return false;
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

const initialPids = pidsOnPort().filter(isNodeProcess);
if (!initialPids.length) process.exit(0);

console.log(`free-port: port ${port} is held by stale node process(es) ${initialPids.join(", ")} — stopping them`);
for (const pid of initialPids) {
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
}

for (let attempt = 0; attempt < 20 && pidsOnPort().length; attempt += 1) sleep(250);

const remaining = pidsOnPort().filter(isNodeProcess);
if (remaining.length) {
  console.log(`free-port: ${remaining.join(", ")} did not exit in time — force-killing`);
  for (const pid of remaining) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
