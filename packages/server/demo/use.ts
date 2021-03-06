import * as http from "../src"

import { pipe } from "@matechs/core/Function"
import * as O from "@matechs/core/Option"
import * as T from "@matechs/core/next/Effect"
import * as L from "@matechs/core/next/Layer"
import * as MO from "@matechs/morphic"
import { HKT2 } from "@matechs/morphic-alg/utils/hkt"
import { AlgebraNoUnion } from "@matechs/morphic/batteries/program"
import { Codec, failure, success } from "@matechs/morphic/model"

export const S = http.makeServer(T.has<http.Server>()())
export const S2 = http.makeServer(T.has<http.Server>()("second"))

export const serverConfig = L.service(S.hasConfig).pure(
  new http.ServerConfig(8080, "0.0.0.0")
)

export const secondServerConfig = L.service(S2.hasConfig).pure(
  new http.ServerConfig(8081, "0.0.0.0")
)

export const currentUser = http.makeState<O.Option<string>>(O.none)

//
// Custom Error Handler
//

export const customErrorResponse = http.response(
  MO.make((F) => F.interface({ error: F.string() }))
)

export const customErrorHandler = T.catchAll((e: http.RequestError) => {
  switch (e._tag) {
    case "JsonDecoding": {
      return pipe(
        customErrorResponse({ error: "invalid json body" }),
        T.first(http.status(400))
      )
    }
    default: {
      return e.render()
    }
  }
})

//
// Auth Middleware
//

export const authMiddleware = S.use(
  "(.*)",
  pipe(
    T.of,
    T.tap(() => currentUser.set(O.some("test"))),
    T.bind("next", () => T.timed(http.next)),
    T.bind("routeInput", () => http.getRouteInput),
    T.chain(({ next: [ms], routeInput: { query } }) =>
      T.effectTotal(() => {
        console.log(`request took: ${ms} ms (${query})`)
      })
    )
  )
)

//
// Person Post Endpoint
//

export const getPersonPostParams = http.params(
  MO.make((F) => F.interface({ id: F.string() }))
)

export const getPersonPostBody = http.body(
  MO.make((F) => F.interface({ name: F.string() }))
)

export const personPostResponse = http.response(
  MO.make((F) => F.interface({ id: F.string(), name: F.string() }))
)

export const personPost = S.route(
  "POST",
  "/person/:id",
  pipe(
    T.of,
    T.bind("params", () => getPersonPostParams),
    T.bind("body", () => getPersonPostBody),
    T.chain(({ body: { name }, params: { id } }) => personPostResponse({ id, name })),
    customErrorHandler
  )
)

//
// Home Child Router
//

export const homeChildRouter = S.child("/home/(.*)")

//
// Home /a GET
//

export const homeGet = S.route(
  "GET",
  "/home/a",
  pipe(
    T.of,
    T.bind("config", () => S.getServerConfig),
    T.bind("routeInput", () => http.getRouteInput),
    T.chain(({ config, routeInput: { res } }) =>
      T.effectTotal(() => {
        res.write(`good: ${config.host}:${config.port}`)
        res.end()
      })
    )
  )
)

//
// Home /b POST
//

export const getHomePostQuery = http.query(
  MO.make((F) =>
    F.partial({
      q: numberString(F)
    })
  )
)

export const homePost = S.route(
  "POST",
  "/home/b",
  pipe(
    T.of,
    T.bind("body", () => http.getBodyBuffer),
    T.bind("query", () => getHomePostQuery),
    T.bind("user", () => currentUser.get),
    T.bind("input", () => http.getRouteInput),
    T.tap(({ body, input: { res }, query, user }) =>
      T.effectTotal(() => {
        res.write(body)
        res.write(JSON.stringify(query))
        res.write(JSON.stringify(user))
        res.end()
      })
    )
  )
)

//
// Custom morphic codec for numbers encoded as strings
//

export function numberString<G, Env>(
  F: AlgebraNoUnion<G, Env>
): HKT2<G, Env, string, number> {
  return F.unknownE(F.number(), {
    conf: {
      [MO.ModelURI]: () =>
        new Codec(
          "numberString",
          (i, c) => {
            if (typeof i === "string") {
              try {
                const n = parseFloat(i)

                if (isNaN(n)) {
                  return failure(i, c)
                }

                return success(n)
              } catch {
                return failure(i, c)
              }
            } else {
              return failure(i, c)
            }
          },
          (u) => (u as number).toString()
        )
    }
  }) as HKT2<G, Env, string, number>
}

//
// App Layer with all the routes, middlewared, the server & the server config
//

export const home = L.using(homeChildRouter)(L.all(homeGet, homePost))

export const appLayer = pipe(
  L.all(home, personPost),
  L.using(authMiddleware),
  L.using(L.all(S.server, S2.server)),
  L.using(L.all(serverConfig, secondServerConfig)),
  L.main
)
