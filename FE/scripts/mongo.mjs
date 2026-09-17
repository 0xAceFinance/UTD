#!/usr/bin/env node
// Manages a persistent, local MongoDB for this app -- real data on disk
// (.mongo/data/), not the throwaway in-memory DB from dev:memory.
//
// Usage: node scripts/mongo.mjs start|stop|status
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const IS_WIN = process.platform === 'win32'
const BIN_DIR = path.join(ROOT, '.mongo/bin')
const BIN = path.join(BIN_DIR, IS_WIN ? 'mongod.exe' : 'mongod')
const DATA_DIR = path.join(ROOT, '.mongo/data')
const LOG_FILE = path.join(ROOT, '.mongo/log/mongod.log')
const PID_FILE = path.join(ROOT, '.mongo/mongod.pid')
const PORT = 27017

function hasRemoteMongoUri() {
  const envFile = path.join(ROOT, '.env.local')
  let uri = process.env.MONGODB_URI || ''
  if (!uri && fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8')
    const match = content.match(/^MONGODB_URI=(.+)$/m)
    if (match) uri = match[1].trim()
  }
  if (!uri) return false
  return uri.startsWith('mongodb+srv://') || (!uri.includes('127.0.0.1') && !uri.includes('localhost'))
}

function ensureBinary() {
  if (fs.existsSync(BIN)) return BIN
  const altBin = path.join(BIN_DIR, IS_WIN ? 'mongod' : 'mongod.exe')
  if (fs.existsSync(altBin)) return altBin

  const cacheDir = path.join(ROOT, 'node_modules/.cache/mongodb-memory-server')
  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir)
    const match = files.find(f => f.startsWith('mongod') && (IS_WIN ? f.endsWith('.exe') : !f.endsWith('.exe'))) || files.find(f => f.startsWith('mongod'))
    if (match) {
      fs.mkdirSync(BIN_DIR, { recursive: true })
      const source = path.join(cacheDir, match)
      fs.copyFileSync(source, BIN)
      return BIN
    }
  }
  return null
}

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
    return false
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  if (!isNaN(pid) && pid > 0 && isRunning(pid)) {
    console.log(`mongod is running (pid ${pid}, port ${PORT}, data at ${DATA_DIR})`)
    return true
  }
  try { fs.unlinkSync(PID_FILE) } catch {}
  return false
}

function start() {
  if (hasRemoteMongoUri()) {
    console.log('Using remote MongoDB from .env.local (skipping local mongod start)')
    return
  }
  if (status()) return

  const binary = ensureBinary()
  if (!binary) {
    console.warn('mongod binary not found in .mongo/bin or node_modules/.cache. Skipping local mongod start.')
    return
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  try {
    const child = spawn(
      binary,
      ['--dbpath', DATA_DIR, '--port', String(PORT), '--logpath', LOG_FILE, '--bind_ip', '127.0.0.1'],
      { detached: true, stdio: 'ignore' }
    )
    child.on('error', (err) => {
      console.warn('mongod process error:', err.message)
      try { fs.unlinkSync(PID_FILE) } catch {}
    })
    child.unref()
    if (child.pid) {
      fs.writeFileSync(PID_FILE, String(child.pid))
      console.log(`mongod starting (pid ${child.pid}) -- data persists at ${DATA_DIR}`)
      console.log(`MONGODB_URI=mongodb://127.0.0.1:${PORT}/mcapduel`)
    }
  } catch (err) {
    console.warn('Failed to start local mongod:', err.message)
  }
}

function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('mongod is not running')
    return
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  if (!isNaN(pid) && pid > 0 && isRunning(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
      console.log(`stopped mongod (pid ${pid})`)
    } catch {}
  }
  try { fs.unlinkSync(PID_FILE) } catch {}
}

const cmd = process.argv[2]
if (cmd === 'start') start()
else if (cmd === 'stop') stop()
else if (cmd === 'status') status()
else {
  console.error('usage: node scripts/mongo.mjs start|stop|status')
  process.exit(1)
}
