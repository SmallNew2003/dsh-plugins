/** Test scaffolding: a real-git subprocess stub and temp repository fixtures. */

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** The service config every test uses. */
export const TEST_CONFIG = {
  commandTimeoutMs: 10_000,
  dirtyCheckLimit: 8,
  statusCacheTtlMs: 50,
} as const

/** A session the fake store knows: cwd stamped into the header. */
export interface FakeSession {
  readonly id: string
  readonly cwd: string
}

/** Subprocess stub backed by the real git binary: same seam, real commands. */
export class GitSubprocessStub implements Partial<SubprocessRuntime> {
  async resolveExecutable(command: string): Promise<string> {
    if (command !== 'git') throw new Error('not found: ' + command)
    return '/usr/bin/git'
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const child = spawn(spec.argv[0] as string, spec.argv.slice(1) as readonly string[], {
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
      spec.signal?.addEventListener('abort', () => { child.kill('SIGKILL') }, { once: true })
    })
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom(offset: number) {
            const text = Buffer.concat(stdout).toString('utf8')
            return { text: text.slice(offset), nextOffset: text.length, lossy: false }
          },
        },
        stderr: {
          readFrom(offset: number) {
            const text = Buffer.concat(stderr).toString('utf8')
            return { text: text.slice(offset), nextOffset: text.length, lossy: false }
          },
        },
      },
      done,
      terminate() { child.kill('SIGTERM') },
      async waitForExit() { return true },
    } as SubprocessHandle
  }
}

/** Provide the services the git service reads, plus the git stub itself. */
export function provideHostServices(ctx: Context, sessions: readonly FakeSession[]): GitSubprocessStub {
  const git = new GitSubprocessStub()
  Reflect.set(ctx, 'subprocess', git)
  Reflect.set(ctx, 'sessions', {
    get(id: string) {
      const found = sessions.find(session => session.id === id)
      return found === undefined ? undefined : { header: { id: found.id, cwd: found.cwd } }
    },
  })
  Reflect.set(ctx, 'sessionPersistence', { stat: async () => undefined })
  return git
}

/** Create one temp git repository with an initial commit (canonical path). */
export async function tempRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-git-host-')))
  await git(root, ['init', '--initial-branch', 'main'])
  await writeFile(join(root, 'README.md'), 'seed\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'seed'])
  return root
}

/** Create one linked worktree checked out on a new branch. */
export async function addWorktree(repo: string, path: string, branch: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await git(repo, ['worktree', 'add', '-b', branch, path])
}

/** Run one git command verbatim (fixtures only, not under test). */
export async function git(cwd: string, argv: readonly string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', argv as string[], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout?.on('data', (chunk: Buffer) => { out += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { err += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(out)
      else reject(new Error('git ' + argv.join(' ') + ' failed: ' + err))
    })
  })
}
