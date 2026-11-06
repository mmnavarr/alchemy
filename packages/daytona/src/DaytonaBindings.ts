import {
  Credentials,
  DEFAULT_ANALYTICS_BASE_URL,
  DEFAULT_TOOLBOX_BASE_URL,
} from "@distilled.cloud/daytona/Credentials";
import * as Binding from "alchemy/Binding";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import { ApiKey, type Permission } from "./ApiKey.ts";

/**
 * How a Daytona binding reaches the API from any host.
 *
 * Daytona authorizes with API keys whose permissions are checked per kind
 * of object, so each binding mints its own {@link ApiKey} for its host at
 * deploy, with only the permissions it needs, and the host reads the key
 * back at runtime through `RuntimeContext`. The deployer's key never
 * leaves the deploying machine, and the host works on any runtime
 * (Cloudflare Workers, Lambda, containers) because the key travels as a
 * plain secret, not a cloud identity.
 */
export interface DaytonaAccess {
  /**
   * Run Daytona operations with the host's minted key. Provides
   * `Credentials` and an `HttpClient`; the result requires only
   * `RuntimeContext`.
   */
  readonly authorize: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Credentials | HttpClient.HttpClient> | RuntimeContext>;
  /** The organization the key acts on. */
  readonly organizationId: Effect.Effect<string, never, RuntimeContext>;
}

/**
 * Resolve once, when a binding's layer is built: returns a function that
 * mints (at deploy) and reads back (at runtime) an API key for the current
 * host, named after the host and `purpose`, with `permissions`.
 */
export const makeAccess = Effect.gen(function* () {
  const Key = yield* ApiKey;
  return Effect.fn(function* (purpose: string, permissions: Permission[]) {
    const host = yield* Binding.Host;
    const key = yield* Key(`${host?.LogicalId ?? ""}${purpose}ApiKey`, { permissions });
    const value = yield* key.value;
    const apiBaseUrl = yield* key.apiBaseUrl;
    const organizationId = yield* key.organizationId;
    const authorize = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const config = {
          apiKey: yield* value,
          apiBaseUrl: yield* apiBaseUrl,
          analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
          toolboxBaseUrl: DEFAULT_TOOLBOX_BASE_URL,
          organizationId: yield* organizationId,
        };
        return yield* effect.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Credentials, Effect.succeed(config)),
              FetchHttpClient.layer,
            ),
          ),
        );
      });
    return {
      authorize,
      organizationId,
    } satisfies DaytonaAccess;
  });
});
