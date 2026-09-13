/** git command execution over the subprocess capability seam, with deadlines. */

import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GitError } from './errors.ts'

/** Outcome of one finished git command (exit facts plus captured streams). */
export interface RunGitResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Collected-stream byte ceiling: git output here is metadata, never a payload. */
const COLLECT_MAX_BYTES = 1024 * 1024

/** Resolve the git executable once per plugin life; null when git is not on PATH. */
export async function resolveGitPath(subprocess: SubprocessRuntime): Promise<string | null> {
  try {
    return await subprocess.resolveExecutable('git')
  } catch {
    // The provider's not-found rejection has exactly one meaning here: unavailable.
    return null
  }
}

/**
 * Run one git command to completion with a deadline.
 * @param subprocess - the composition's subprocess service.
 * @param gitPath - resolved git executable path.
 * @param argv - arguments after git.
 * @param cwd - working directory for the command.
 * @param deadlineMs - per-command deadline in milliseconds.
 * @returns exit facts and captured stdout/stderr.
 * @throws GitError git/command-failed on spawn failure, timeout, or abort.
 */
export async function runGit(
  subprocess: SubprocessRuntime,
  gitPath: string,
  argv: readonly string[],
  cwd: string,
  deadlineMs: number,
): Promise<RunGitResult> {
  const signal = AbortSignal.timeout(deadlineMs)
  try {
    const handle = subprocess.spawn({
      argv: [gitPath, ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: COLLECT_MAX_BYTES },
        stderr: { maxBytes: COLLECT_MAX_BYTES },
      },
      graceMs: 500,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return { exitCode: outcome.exitCode, stdout, stderr }
  } catch (error) {
    const reason = signal.aborted
      ? 'timed out or aborted after ' + String(deadlineMs) + 'ms'
      : (error instanceof Error ? error.message : String(error))
    throw new GitError('git/command-failed', 'git command failed: git ' + argv.join(' '), reason)
  }
}
