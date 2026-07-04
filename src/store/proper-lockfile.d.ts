declare module "proper-lockfile" {
  export function lock(file: string, options?: unknown): Promise<() => Promise<void>>;
}
