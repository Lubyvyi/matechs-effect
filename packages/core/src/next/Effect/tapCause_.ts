import { Cause } from "../Cause/cause"

import { Effect } from "./effect"
import { foldCauseM_ } from "./foldCauseM_"
import { succeedNow } from "./succeedNow"

/**
 * Returns an effect that effectually "peeks" at the cause of the failure of
 * this effect.
 */
export const tapCause_ = <S2, R2, A2, S, R, E, E2>(
  effect: Effect<S2, R2, E2, A2>,
  f: (e: Cause<E2>) => Effect<S, R, E, any>
) => foldCauseM_(effect, f, succeedNow)
