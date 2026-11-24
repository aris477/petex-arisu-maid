// Register playback actions here once for the scheduler, settings and defaults.
export const ACTIONS = Object.freeze({
  waving: {label:'wave', builtin:true},
  jumping: {label:'jump', builtin:true, weight:22},
  failed: {label:'sad', weight:15},
  waiting: {label:'wait', weight:25},
  running: {label:'work', weight:25},
  review: {label:'look', weight:25},
  cleaning10: {label:'cleanScreen', asset:'cleaningUrl', ready:'cleaning10'},
  'running-left': {label:'left', builtin:true, travel:'left'},
  'running-right': {label:'right', builtin:true, travel:'right'},
  'mop-left': {label:'mopLeft', asset:'mopLeftUrl', mop:'left'},
  'mop-right': {label:'mopRight', asset:'mopRightUrl', mop:'right'},
  petting3: {label:'petting', manual:true},
});

const weighted = Object.entries(ACTIONS).filter(([,action])=>!action.manual);
export const DEFAULT_ACTION_WEIGHTS = Object.freeze(Object.fromEntries(weighted.map(([name,action])=>[name,action.weight??20])));
export function availableAnimations(pet) {
  return weighted.filter(([,action])=>pet?.builtin ? action.builtin : !action.asset||pet?.[action.asset]).map(([name])=>name);
}

export const MAX_ACTION_WEIGHT = 100;

export function normalizeActionWeights(input) {
  return Object.fromEntries(Object.entries(DEFAULT_ACTION_WEIGHTS).map(([name, weight]) => {
    const value = input?.[name];
    return [name, Number.isFinite(value) ? Math.max(0, Math.min(MAX_ACTION_WEIGHT, Math.round(value))) : weight];
  }));
}
