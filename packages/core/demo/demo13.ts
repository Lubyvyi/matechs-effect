import { pipe } from "../src/Function"
import * as T from "../src/next/Effect"
import * as F from "../src/next/FiberRef"
import * as L from "../src/next/Layer"

export abstract class Console {
  abstract putStrLn(s: string): T.Sync<void>
}

export abstract class Format<F> {
  abstract formatString(s: F): T.Sync<F>
}

export abstract class AppConfig<S> {
  abstract readonly config: S
}

export const HasConsole = T.has(Console)()
export type HasConsole = T.HasType<typeof HasConsole>

export const HasFormat = T.has(Format)().refine<Format<string>>()
export type HasFormat = T.HasType<typeof HasFormat>

export const HasAppConfig = T.has<AppConfig<string>>()()
export type HasAppConfig = T.HasType<typeof HasAppConfig>

export const HasScopedAppConfig = T.has<AppConfig<string>>()("Scoped")
export type HasScopedAppConfig = T.HasType<typeof HasScopedAppConfig>

export const HasNumberConfig = T.has<AppConfig<number>>()("Number")
export type HasNumberConfig = T.HasType<typeof HasNumberConfig>

export const putStrLn = (s: string) =>
  T.accessServiceM(HasConsole)((console) => console.putStrLn(s))

export const formatString = (s: string) =>
  T.accessServiceM(HasFormat)((f) => f.formatString(s))

export class LiveConsole extends Console {
  constructor(private readonly format: Format<string>) {
    super()
  }

  putStrLn(s: string): T.Sync<void> {
    return T.chain_(this.format.formatString(s), (f) =>
      T.provideService(HasFormat)(this.format)(
        T.effectTotal(() => {
          console.log(f)
        })
      )
    )
  }
}

export class AugumentedConsole extends Console {
  constructor(private readonly runtime: T.Runtime<HasFormat>) {
    super()
  }

  putStrLn(s: string): T.Sync<void> {
    return this.runtime.in(
      T.chain_(formatString(s), (f) =>
        T.effectTotal(() => {
          console.log("(augumented) ", f)
        })
      )
    )
  }
}

export const provideConsole = L.service(HasConsole.overridable()).fromEffect(
  T.accessService(HasFormat)((format) => new LiveConsole(format))
)

export const provideAugumentedConsole = L.service(HasConsole.overridable()).fromEffect(
  T.withRuntime((runtime: T.Runtime<HasFormat>) => new AugumentedConsole(runtime))
)

export const complexAccess: T.SyncR<
  HasConsole & HasAppConfig & HasScopedAppConfig & HasNumberConfig,
  void
> = T.accessServicesM({
  console: HasConsole,
  app: HasAppConfig,
  scoped: HasScopedAppConfig,
  numberConfig: HasNumberConfig
})(({ app, console, numberConfig, scoped }) =>
  console.putStrLn(`${app.config} - (${scoped.config}) - (${numberConfig.config})`)
)

export const provideFormat = L.service(HasFormat).pure(
  new (class extends Format<string> {
    formatString(s: string): T.Sync<string> {
      return T.effectTotal(() => `running: ${s}`)
    }
  })()
)

export const hasPrinter0 = L.hasProcess("printer-0")<never, void>()
export const hasPrinter1 = L.hasProcess("printer-1")<never, void>()
export const hasPrinter2 = L.hasProcess("printer-2")<never, void>()
export const hasPrinter3 = L.hasProcess("printer-3")<never, void>()

export interface Metrics {
  counter: number
}

export const metrics = F.unsafeMake<Metrics>(
  { counter: 0 },
  (_) => ({ counter: 0 }),
  (a, b) => ({ counter: a.counter + b.counter })
)

export const printMetrics = <ID extends string>(has: L.HasProcess<ID, never, void>) =>
  T.accessServiceM(has)((f) =>
    T.chain_(f.getRef(metrics), ({ counter }) =>
      putStrLn(`#${f.id.seqNumber} - ${f.state._tag} (${counter})`)
    )
  )

export const printAllMetrics = T.sequenceTParN(2)(
  T.delay(1000)(printMetrics(hasPrinter0)),
  T.delay(1000)(printMetrics(hasPrinter1)),
  T.delay(1000)(printMetrics(hasPrinter2)),
  T.delay(1000)(printMetrics(hasPrinter3)),
  T.delay(1000)(
    T.chain_(L.globalRef(metrics), ({ counter }) =>
      putStrLn(`Across all processes: ${counter}`)
    )
  )
)

export const program = pipe(
  T.forever(printAllMetrics),
  T.chain(() => complexAccess)
)

export const provideAppConfig = L.service(HasAppConfig).pure(
  new (class extends AppConfig<string> {
    config = "ok"
  })()
)

export const provideNumberConfig = L.service(HasNumberConfig).pure(
  new (class extends AppConfig<number> {
    config = 1
  })()
)

export const provideScopedAppConfig = L.service(HasScopedAppConfig).pure(
  new (class extends AppConfig<string> {
    config = "ok - scoped"
  })()
)

export const printer = <ID extends string>(
  has: L.HasProcess<ID, never, void>,
  n: number
) =>
  L.makeProcess(has)(
    T.forever(
      T.onInterrupt_(
        pipe(
          metrics,
          F.update(({ counter }) => ({ counter: counter + 1 })),
          T.delay(100 * n)
        ),
        () =>
          n > 1
            ? T.die(`interruption error: ${n}`)
            : T.effectTotal(() => {
                console.log("interrupted")
              })
      )
    )
  )

export const mainLayer = pipe(
  L.all(provideAppConfig, provideConsole, provideScopedAppConfig, provideNumberConfig),
  L.using(provideAugumentedConsole),
  L.using(provideFormat),
  L.using(
    L.allPar(
      printer(hasPrinter0, 1),
      printer(hasPrinter1, 2),
      printer(hasPrinter2, 3),
      printer(hasPrinter3, 4)
    )
  )
)

const cancel = pipe(program, T.provideSomeLayer(mainLayer), T.runMain)

process.on("SIGINT", () => {
  cancel()
})
process.on("SIGTERM", () => {
  cancel()
})
