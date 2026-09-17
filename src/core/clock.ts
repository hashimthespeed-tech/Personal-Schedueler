/**
 * Today, in his timezone.
 *
 * Four lines, but load-bearing: a naive `new Date().toISOString().slice(0,10)`
 * rolls over at 4pm local, so at dinner the app would show tomorrow's day and
 * log completions against the wrong date.
 *
 * Lived in agents/context.ts until the agents were removed, which is the wrong
 * place for it — five pages with no AI in them depend on it.
 */

import { DateTime } from "luxon";
import { LA_MESA } from "./prayer";
import type { IsoDate } from "./types";

export function today(zone = LA_MESA.timezone): IsoDate {
  const iso = DateTime.now().setZone(zone).toISODate();
  if (!iso) throw new Error("Cannot resolve today's date");
  return iso;
}

/** `n` days before `date`, same zone. */
export function daysAgo(date: IsoDate, n: number): IsoDate {
  const iso = DateTime.fromISO(date).minus({ days: n }).toISODate();
  if (!iso) throw new Error(`Cannot rewind ${n} days from ${date}`);
  return iso;
}
