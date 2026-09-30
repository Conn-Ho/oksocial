/**
 * Simulated slots for end-to-end tests. With SIM_OPENCLI_BIN set, every slot named `sim-*` is
 * virtual: it has no Chrome and no account-ctl entry, and its runs execute the simulator
 * (sim/sim-opencli.mjs) instead of opencli. Every other slot name goes to account-ctl exactly as
 * before. Without SIM_OPENCLI_BIN nothing here is used and `sim-*` names are ordinary slots.
 *
 * Simulated slots are not listed by GET /slots or counted by /health: they exist only by name.
 */
import type { Slot } from './account-ctl.ts';
import { HttpError } from './errors.ts';
import type { SlotsService } from './slots.ts';

export const SIM_SLOT_PREFIX = 'sim-';

/** True for names the simulator owns (when simulation is enabled). Pure. */
export const isSimSlotName = (name: string): boolean => name.startsWith(SIM_SLOT_PREFIX);

/**
 * The slot a simulated name stands for: always active, its bridge profile id is the slot name
 * (the simulator reads it from OPENCLI_PROFILE to know which account it plays). Pure.
 */
export function simulatedSlot(name: string): Slot {
  return { name, display: 0, cdp: 0, screenPort: 0, chrome: 'active', unit: 'simulated', profileId: name, proxy: false, screen: false };
}

/** A simulated slot has no browser to open tabs in or to watch. */
export const simulatedSlotError = (name: string): HttpError =>
  new HttpError(400, 'SIMULATED_SLOT', `slot ${name} is simulated: it has no browser, tabs or screen`);

/** Wrap the real slots service so sim-* names never reach account-ctl. */
export function withSimulatedSlots(real: SlotsService): SlotsService {
  const sim = (name: string): Slot | undefined => (isSimSlotName(name) ? simulatedSlot(name) : undefined);
  return {
    list: (maxAgeMs) => real.list(maxAgeMs),
    get: async (name, maxAgeMs) => sim(name) ?? real.get(name, maxAgeMs),
    require: async (name, maxAgeMs) => sim(name) ?? real.require(name, maxAgeMs),
    ensure: async (name, proxy) => {
      const slot = sim(name);
      return slot ? { slot, created: false } : real.ensure(name, proxy);
    },
    setProxy: async (name, proxy) => sim(name) ?? real.setProxy(name, proxy),
    start: async (name) => sim(name) ?? real.start(name),
    stop: async (name) => sim(name) ?? real.stop(name),
    restart: async (name) => (isSimSlotName(name) ? undefined : real.restart(name)),
    remove: async (name, purge) => (isSimSlotName(name) ? undefined : real.remove(name, purge)),
    startScreen: async (name) => {
      if (isSimSlotName(name)) throw simulatedSlotError(name);
      return real.startScreen(name);
    },
    stopScreen: async (name) => {
      if (isSimSlotName(name)) throw simulatedSlotError(name);
      return real.stopScreen(name);
    },
    isSimulated: isSimSlotName,
  };
}
