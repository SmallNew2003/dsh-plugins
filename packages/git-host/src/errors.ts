/** Structured git error vocabulary shared by routes, tools, and tests. */

/** Every user-visible git failure has exactly one code from this set. */
export type GitErrorCode =
  | 'git/unavailable'
  | 'git/not-repo'
  | 'git/missing-dir'
  | 'git/dirty'
  | 'git/protected'
  | 'git/command-failed'

/** JSON error body shape every route and tool consumer receives. */
export interface GitErrorBody {
  readonly code: GitErrorCode
  readonly message: string
  readonly detail?: string
}

/**
 * One structured git failure. The code is the contract the UI maps to copy;
 * the message is an English diagnostic for logs and the model.
 */
export class GitError extends Error {
  readonly code: GitErrorCode
  readonly detail: string | undefined

  constructor(code: GitErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.detail = detail
  }

  /** The wire body: code, message, and detail only when present. */
  body(): GitErrorBody {
    return { code: this.code, message: this.message, ...(this.detail === undefined ? {} : { detail: this.detail }) }
  }
}

/** True when the thrown value is a structured git failure. */
export function isGitError(value: unknown): value is GitError {
  return value instanceof GitError
}
