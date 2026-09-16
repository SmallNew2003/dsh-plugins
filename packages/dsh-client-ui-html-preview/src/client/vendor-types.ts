/**
 * Structural surfaces of the framework services this plugin consumes at
 * runtime. Following the memory-plugin precedent, the client half stays free
 * of @deepseek-ai value imports: every cross-package call goes through these
 * locally-declared shapes, resolved off the client context by serviceOf.
 */

/** Locale dictionary registration seat. */
export interface ClientLocale {
  register(namespace: string, dictionaries: { zh: unknown; en: unknown }): unknown
}

/** Slot declaration and registration seat, with the keyed/list options used here. */
export interface ClientSlots {
  inject(name: string, contribute: () => unknown): unknown
  register(options: {
    name: string
    key?: string
    priority?: number
    locale?: string
    inject?: () => unknown
  }, component: unknown): unknown
}

/** Workspace file bytes over the session-authorized remote. */
export type WorkspaceFileReadAllResult =
  | { readonly ok: true; readonly value: { readonly data: string } }
  | { readonly ok: false; readonly error?: { readonly message?: string } }

export interface ClientRemotes {
  workspaceFiles: {
    readAll(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileReadAllResult>
  }
}

/** Decode the base64 payload carried by a successful workspace-file response. */
export function bytesFromBase64(data: string): Uint8Array {
  const binary = atob(data)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/** Read one context service by name without importing the framework types. */
export function serviceOf<T>(ctx: unknown, name: string): T {
  return Reflect.get(ctx as { [key: string]: unknown }, name) as T
}
