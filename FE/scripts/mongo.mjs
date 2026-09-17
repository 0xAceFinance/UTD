#!/usr/bin/env node
// Manages a persistent, local MongoDB for this app -- real data on disk
// (.mongo/data/), not the throwaway in-memory DB from dev:memory. There's no
// system mongod available in this environment (no package manager access,
// no sudo), so this reuses the real mongod binary mongodb-memory-server
// already downloaded, copied out of node_modules/.cache so it survives a
// fresh `npm install`.
//
// Usage: node scripts/mongo.mjs start|stop|status
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BIN = path.join(ROOT, '.mongo/bin/mongod')
const DATA_DIR = path.join(ROOT, '.mongo/data')
const LOG_FILE = path.join(ROOT, '.mongo/log/mongod.log')
const PID_FILE = path.join(ROOT, '.mongo/mongod.pid')
const PORT = 27017

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function status() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('mongod is not running (no pid file)')
    return false
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  if (isRunning(pid)) {
    console.log(`mongod is running (pid ${pid}, port ${PORT}, data at ${DATA_DIR})`)
    return true
  }
  console.log('mongod is not running (stale pid file)')
  return false
}

function start() {
  if (status()) return
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  const child = spawn(
    BIN,
    ['--dbpath', DATA_DIR, '--port', String(PORT), '--logpath', LOG_FILE, '--bind_ip', '127.0.0.1'],
    { detached: true, stdio: 'ignore' }
  )
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))
  console.log(`mongod starting (pid ${child.pid}) -- data persists at ${DATA_DIR}`)
  console.log(`MONGODB_URI=mongodb://127.0.0.1:${PORT}/mcapduel`)
}

function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('mongod is not running')
    return
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  if (isRunning(pid)) {
    process.kill(pid, 'SIGTERM')
    console.log(`stopped mongod (pid ${pid})`)
  }
  fs.unlinkSync(PID_FILE)
}

const cmd = process.argv[2]
if (cmd === 'start') start()
else if (cmd === 'stop') stop()
else if (cmd === 'status') status()
else {
  console.error('usage: node scripts/mongo.mjs start|stop|status')
  process.exit(1)
}
