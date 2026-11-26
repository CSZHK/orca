import { configuredProxyEnv } from '../network/configured-proxy-env'

export type ProviderProcessLaunch = {
  command: string
  args: string[]
  /** Workspace directory used by the provider process itself. */
  cwd?: string
  /** Overlay on the inherited environment. */
  env?: Record<string, string>
  /** Keys stripped after the overlay. */
  envToDelete?: readonly string[]
}

export function resolveProviderChildEnv(
  launch: Pick<ProviderProcessLaunch, 'env' | 'envToDelete'>,
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  // Provider processes hit the network from the desktop shell env, which carries
  // no proxy; inject the configured one under launch.env (it stays authoritative).
  const childEnv: NodeJS.ProcessEnv = { ...baseEnv, ...configuredProxyEnv(), ...launch.env }
  for (const key of launch.envToDelete ?? []) {
    delete childEnv[key]
  }
  return childEnv
}
