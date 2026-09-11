/**
 * Minimal local types for the slot and locale services, following the
 * client-ui-git precedent of consuming browser-side services through
 * locally-declared structural surfaces. Type-only: erased at runtime.
 */

/** One dictionary of translated strings. */
export type LocaleDictionary = Readonly<Record<string, string>>

/** Model of the translator the locale service injects for one namespace. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string

/** Structural surface of the framework slot registry this plugin consumes. */
export interface ClientSlots {
  /** Contribute to one declared slot key; the callback registers this entry. */
  inject(name: string, contribute: () => unknown): void
  /** Register one entry into a declared slot key. */
  register(
    options: {
      readonly name: string
      /** Keyed-slot dispatch value: the wire tool name this view owns. */
      readonly key: string
      readonly locale: string
    },
    component: unknown,
  ): unknown
}

/** Structural surface of the locale service this plugin consumes. */
export interface ClientLocale {
  /** Register one namespace dictionary pair (zh source of truth, en mirror). */
  register(namespace: string, dictionaries: { readonly zh: LocaleDictionary; readonly en: LocaleDictionary }): unknown
}

/** Read a browser-side service by name with a local structural surface. */
export function serviceOf<T>(ctx: unknown, name: string): T {
  return Reflect.get(ctx as { [key: string]: unknown }, name) as T
}
